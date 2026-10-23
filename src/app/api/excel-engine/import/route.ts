import { runRecoverableImport } from "@/lib/import-recovery";
import { assertIdentity, identityText, sameInterviewDay, sameFactory, isActiveAssignment, resolveBonusAssignment } from "@/lib/duplicate-check";
import { splitImportReview } from "@/lib/import-review";
import { saveImportSource as saveSourceSnapshot } from "@/lib/import-source-store";
import { sourceStatuses } from "@/lib/source-format";
import {
  dateKey,
  phoneKey,
  normalizeCccd,
} from "@/lib/worker-validation";
import { NextRequest, NextResponse } from "next/server";
import { prisma as database } from "@/lib/prisma";
import * as XLSX from "xlsx";
import { guard, identity } from "@/lib/local-request";
import { parseImportRow } from "@/lib/worker-import";
import { parseBonusImportRow, readBonusValue } from "@/lib/bonus-import";
import { assignmentRelations, today } from "@/lib/domain";
import crypto from "node:crypto";

export const maxDuration = 600;

const MAX_IMPORT_ROWS = 100_000;

function invalidRowCountResponse(count: number, label = "File") {
  if (!count || count > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      {
        success: false,
        message: `${label} cần từ 1 đến 100.000 dòng dữ liệu`,
      },
      { status: 400 },
    );
  }
  return null;
}

type SheetEntries = {
  sheetName: string;
  headers: string[];
  entries: Array<{
    row: number;
    raw: Record<string, any>;
    values: any[];
  }>;
};

const headerKeywordsByType: Record<string, string[]> = {
  DS_TONG: [
    "họ và tên",
    "họ tên",
    "số cccd",
    "cccd",
    "cmt",
    "nhà máy pv",
    "ngày pv",
    "tình trạng",
    "mã nv",
    "stt",
  ],
  DS_THUONG: [
    "thưởng lần 1",
    "tiền thưởng l1",
    "tên thưởng l1",
    "tổng thưởng",
    "chính sách",
    "số cccd",
    "cccd",
    "họ tên",
    "họ và tên",
    "ngày pv",
    "công ty",
    "stt",
  ],
  BANK_ACCOUNTS: [
    "stk",
    "số tài khoản",
    "cmt/cccd",
    "số cccd",
    "cccd",
    "tên chủ tài khoản",
    "ngân hàng",
    "tình trạng stk",
    "tt",
    "stt",
  ],
};

function extractSheetData(
  book: XLSX.WorkBook,
  targetSheetName: string,
  detectedType: "DS_TONG" | "DS_THUONG" | "BANK_ACCOUNTS",
  profile?: any,
): SheetEntries | null {
  const sheet = book.Sheets[targetSheetName];
  if (!sheet) return null;

  const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: true,
  });

  let headerRowIndex = -1;
  let headers: string[] = [];
  const targetKeywords = headerKeywordsByType[detectedType] || [
    "cccd",
    "họ tên",
    "họ và tên",
  ];

  for (let rIdx = 0; rIdx < Math.min(matrix.length, 10); rIdx++) {
    const row = matrix[rIdx];
    if (!Array.isArray(row) || !row.length) continue;
    const rowStrArr = row.map((v) =>
      String(v ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    const rowLower = rowStrArr.map((v) => v.toLowerCase());

    const hasPersonalData = rowStrArr.some(
      (v) => /^0\d{8,11}$/.test(v) || /^0\d{9,10}$/.test(v),
    );
    if (hasPersonalData) continue;

    const matchCount = targetKeywords.filter((k) =>
      rowLower.some((cell) => cell.includes(k)),
    ).length;
    if (matchCount >= 2 || (profile && rowLower.some((c) => c.length > 0))) {
      headerRowIndex = rIdx;
      headers = rowStrArr;
      break;
    }
  }

  if (headerRowIndex === -1) return null;

  const entries: SheetEntries["entries"] = [];
  for (let index = headerRowIndex + 1; index < matrix.length; index++) {
    const values = matrix[index];
    if (!values.some((v) => String(v ?? "").trim() !== "")) continue;
    if (entries.length >= MAX_IMPORT_ROWS) {
      throw new Error(`Sheet "${targetSheetName}" vượt quá 100.000 dòng dữ liệu.`);
    }
    entries.push({
      row: index + 1,
      raw: Object.fromEntries(headers.map((h, i) => [h, values[i]])),
      values,
    });
  }

  return {
    sheetName: targetSheetName,
    headers,
    entries,
  };
}

// Read only enough rows to identify the header, preserving blank-row handling.
function readHeaderRows(sheet: XLSX.WorkSheet): any[][] {
  if (!sheet["!ref"]) return [];
  const bounds = XLSX.utils.decode_range(sheet["!ref"]);
  const rows: any[][] = [];
  for (let start = bounds.s.r; start <= bounds.e.r && rows.length < 6; start += 64) {
    const chunk = XLSX.utils.sheet_to_json<any[]>(sheet, {
      header: 1, defval: "", blankrows: false,
      range: { s: { r: start, c: bounds.s.c }, e: { r: Math.min(start + 63, bounds.e.r), c: bounds.e.c } },
    });
    rows.push(...chunk.slice(0, 6 - rows.length));
  }
  return rows;
}

function readyRowSample(entries: SheetEntries["entries"], errors: string[]) {
  const blocked = new Set(errors.map((message) => Number(/^Dòng (\d+):/.exec(message)?.[1] || 0)));
  return entries.filter((entry) => !blocked.has(entry.row)).slice(0, 50).map((entry) => ({
    row: entry.row,
    fullName: entry.raw["Họ tên"] || entry.raw["Họ và tên"] || entry.raw["Tên chủ tài khoản"] || "",
    idCard: String(entry.raw["Số CCCD"] || entry.raw["số CCCD"] || entry.raw["CCCD"] || entry.raw["CMT/CCCD"] || ""),
    factory: entry.raw["Nhà máy PV"] || entry.raw["Công ty"] || "",
  }));
}

// Compare imported cell values, not ZIP timestamps, styles or document metadata.
function workbookDataFingerprint(book: XLSX.WorkBook): string {
  const hash = crypto.createHash("sha256");
  hash.update("workbook-cells-v1");
  for (const name of book.SheetNames) {
    hash.update(JSON.stringify(["sheet", name]));
    const sheet = book.Sheets[name];
    if (!sheet?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    for (let row = range.s.r; row <= range.e.r; row++) {
      const values: Array<[number, unknown]> = [];
      for (let column = range.s.c; column <= range.e.c; column++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "") {
          values.push([column, cell.v]);
        }
      }
      if (values.length) hash.update(JSON.stringify([row, values]));
    }
  }
  return "cells-v1:" + hash.digest("hex");
}

export async function POST(request: NextRequest) {
  let prisma = database;
  let saveImportSource = saveSourceSnapshot;
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const form = await request.formData();
    const commit = form.get("confirm") === "true";
    if (commit && typeof prisma.$queryRawUnsafe === "function") {
      const required: Record<string, string[]> = { WorkAssignment: ["interviewFactoryId", "workingFactoryId", "statusId"], BonusPolicy: ["factoryId"], BonusRecord: ["accountNumber", "bankName"] };
      for (const [table, fields] of Object.entries(required)) {
        const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
        if (fields.some((field) => !columns.some((column) => column.name === field))) {
          return NextResponse.json({ success: false, message: "Chưa thể ghi: cấu trúc database chưa đồng bộ với phiên bản ứng dụng. Kết quả quét chưa được lưu; cần đồng bộ database trước." }, { status: 409 });
        }
      }
    }
    const googleSheetUrl = String(form.get("googleSheetUrl") || "").trim();
    const file = form.get("file");

    let fileBuffer: Buffer;
    let fileName: string;

    if (googleSheetUrl) {
      const match = googleSheetUrl.match(
        /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
      );
      if (!match) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Đường dẫn Google Sheets không hợp lệ. Vui lòng kiểm tra lại.",
          },
          { status: 400 },
        );
      }
      const spreadsheetId = match[1];
      // Luôn tải toàn bộ Workbook (.xlsx) để đọc được cả 2 sheet Thưởng và DS Tổng
      const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;

      try {
        const gRes = await fetch(exportUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          },
          // Lần đầu ~100.000 dòng: cho phép tải workbook lâu hơn, không hash CSV mỗi phút
          signal: AbortSignal.timeout(10 * 60 * 1000),
        });
        if (!gRes.ok) {
          return NextResponse.json(
            {
              success: false,
              message:
                `Google Sheets trả mã ${gRes.status}; chưa tải được file bằng truy cập không đăng nhập. Kiểm tra đúng link và quyền xem, hoặc tải file .xlsx để xem trước.`,
            },
            { status: 400 },
          );
        }
        fileBuffer = Buffer.from(await gRes.arrayBuffer());
        fileName = `GoogleSheet_${spreadsheetId.substring(0, 8)}.xlsx`;
      } catch (err: any) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Lỗi kết nối tới Google Sheets: " +
              (err?.message || "Không thể truy cập"),
          },
          { status: 400 },
        );
      }
    } else {
      if (
        !file ||
        typeof file === "string" ||
        file.size > 50 * 1024 * 1024 ||
        !file.size ||
        !file.name.toLowerCase().endsWith(".xlsx")
      ) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Chọn file .xlsx tối đa 50 MB hoặc nhập link Google Sheets hợp lệ",
          },
          { status: 400 },
        );
      }
      fileBuffer = Buffer.from(await file.arrayBuffer());
      fileName = file.name;
    }

    const book = XLSX.read(fileBuffer, { type: "buffer" });
    const previewFingerprint = workbookDataFingerprint(book);
    if (commit && form.get("previewFingerprint") && form.get("previewFingerprint") !== previewFingerprint) {
      return NextResponse.json({ success: false, message: String(form.get("previewFingerprint")).startsWith("cells-v1:") ? "Dữ liệu trong các ô đã thay đổi sau lần quét. Hãy quét lại trước khi xác nhận ghi." : "Cơ chế kiểm tra nguồn đã cập nhật. Bấm Đồng bộ để quét lại một lần trước khi ghi." }, { status: 409 });
    }
    const smartMerge = form.get("smartMerge") !== "false";
    const actor = (await identity(request))!;
    const requestedType = String(
      form.get("importType") || "AUTO",
    ).toUpperCase();

    const importOptions = { importType: requestedType, smartMerge, profileId: String(form.get("profileId") || "") };
    const signature = crypto.createHash("sha256").update(JSON.stringify({ previewFingerprint, ...importOptions, database: process.env.DATABASE_URL || "local" })).digest("hex");
    const fallback = signature.slice(0, 32);
    const importRunId = String(form.get("importRunId") || (commit
      ? [fallback.slice(0,8), fallback.slice(8,12), fallback.slice(12,16), fallback.slice(16,20), fallback.slice(20)].join("-")
      : crypto.randomUUID())).toLowerCase();
    const execute = async () => {
    const sheetNames = book.SheetNames;
    if (!sheetNames.length) {
      return NextResponse.json(
        { success: false, message: "File Excel không có sheet nào" },
        { status: 400 },
      );
    }

    let profile: any = null;
    if (form.get("profileId")) {
      profile = await prisma.importProfile.findUnique({
        where: { id: String(form.get("profileId")) },
      });
    }

    // Quét tiêu đề tất cả các sheet trong Workbook
    const sheetHeadersMap = new Map<string, string[]>();
    for (const sName of sheetNames) {
      const s = book.Sheets[sName];
      if (!s) continue;
      const m = readHeaderRows(s);
      let h: string[] = [];
      for (const row of m.slice(0, 6)) {
        const rowStr = (row || [])
          .map((v: any) =>
            String(v)
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase(),
          )
          .join(" ");
        if (
          rowStr.includes("cccd") ||
          rowStr.includes("họ tên") ||
          rowStr.includes("họ và tên") ||
          rowStr.includes("thưởng") ||
          rowStr.includes("stk")
        ) {
          h = (row || []).map((v: any) =>
            String(v).replace(/\s+/g, " ").trim(),
          );
          break;
        }
      }
      if (!h.length && m[0]) {
        h = (m[0] || []).map((v: any) =>
          String(v).replace(/\s+/g, " ").trim(),
        );
      }
      sheetHeadersMap.set(sName, h);
    }

    // Phân loại từng sheet trong file
    let foundTongSheet = "";
    let foundBonusSheet = "";
    let foundBankSheet = "";

    for (const [sName, hdrs] of sheetHeadersMap.entries()) {
      const hStr = hdrs.join(" ").toLowerCase();
      const sNorm = sName
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();

      if (
        hStr.includes("thưởng lần 1") ||
        hStr.includes("tiền thưởng l1") ||
        (hStr.includes("chính sách") && hStr.includes("tổng thưởng")) ||
        (sNorm.includes("thuong") && !hStr.includes("nhà máy pv"))
      ) {
        if (!foundBonusSheet) foundBonusSheet = sName;
      } else if (
        hStr.includes("tình trạng stk") ||
        hStr.includes("người check") ||
        (hStr.includes("stk") && hStr.includes("tên chủ tài khoản")) ||
        sNorm.includes("stk") ||
        sNorm.includes("ngan hang")
      ) {
        if (!foundBankSheet) foundBankSheet = sName;
      } else if (
        hStr.includes("nhà máy pv") ||
        (hStr.includes("ngày sinh") && hStr.includes("giới tính")) ||
        sNorm.includes("tong") ||
        sNorm.includes("ho so")
      ) {
        if (!foundTongSheet) foundTongSheet = sName;
      }
    }

    // Hàm xử lý Sheet DS_TONG (trả về kết quả + bản đồ people đã cập nhật)
    async function processDsTongSheet(sheetData: SheetEntries) {
      const { sheetName: targetSheetName, headers, entries } = sheetData;
      if (
        new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length
      ) {
        throw new Error(
          `Sheet "${targetSheetName}" có tên cột bị trùng; cần kiểm tra lại dòng tiêu đề`,
        );
      }

      const mapping = profile ? JSON.parse(profile.mappingJson) : null;
      const existing = await prisma.worker.findMany({
        include: { assignments: true, bankAccounts: true },
      });
      const people = new Map<string, any>(existing.map((w) => [w.idCard, w]));
      const statuses = await prisma.laborStatus.findMany({
        where: { isActive: true },
      });
      const factories = await prisma.factory.findMany({ where: { isActive: true } });
      const statusNamesSet = new Set(statuses.map((s) => s.name));
      const phones = new Map<string, Set<string>>();
      const indexPhone = (w: any) => {
        const key = phoneKey(w.phone || "");
        if (key && !w.archivedAt && (w.assignments || []).some((a: any) => isActiveAssignment(a, statuses))) {
          const cards = phones.get(key) || new Set<string>(); cards.add(w.idCard); phones.set(key, cards);
        }
      };
      existing.forEach(indexPhone);

      const labels: Record<string, string> = {
        fullName: "Họ và tên",
        idCard: "số CCCD",
        interviewFactory: "Nhà máy PV",
        contractType: "Loại HĐ",
        interviewDate: "Ngày PV",
        employeeCode: "Mã nhân viên",
        interviewResult: "Kết quả PV",
        passedDate: "Ngày đỗ",
        team: "Team",
        code: "Mã NV",
        phone: "SĐT",
        dob: "Ngày sinh",
        gender: "Giới tính",
        address: "Địa chỉ",
        province: "Tỉnh/Thành",
        recruiter: "Tuyển dụng",
        source: "Nguồn",
        status: "Tình trạng",
        startDate: "Ngày bắt đầu làm",
        leaveDate: "Ngày NH",
        leaveReason: "Lý do",
        onboardingMonth: "Tháng nhận việc",
        shuttleBusKtx: "Đón xe - KTX",
        expectedTrainingDate: "Ngày ĐT dự kiến",
        expectedTrainingStatus: "TT ĐT dự kiến",
        standardTrainingDate: "Ngày ĐT chuẩn",
        idCardDate: "Ngày cấp CCCD",
        idCardPlace: "Nơi cấp CCCD",
      };

      let successCount = 0;
      let readyCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;
      let rehireCount = 0;
      let mergedCount = 0;
      const errors: string[] = [];
      const warnings: string[] = [];

      const seenInFile = new Map<string, number>();
      const newStatusesToUpsert = new Set<string>();
      const workersToCreate = new Map<string, any>();
      const assignmentsToCreate: any[] = [];
      const eventsToCreate: any[] = [];
      const updateTasks: Array<(tx: any) => Promise<void>> = [];

      for (const e of entries) {
        try {
          let raw = e.raw;
          if (mapping) {
            raw = { ...raw };
            for (const [field, column] of Object.entries(mapping)) {
              if (labels[field])
                raw[labels[field]] = e.raw[String(column).trim()];
            }
          }
          const { worker, assignment } = parseImportRow(raw, true);
          const sourceCard = String(raw["số CCCD"] ?? raw["Số CCCD"] ?? raw["CCCD"] ?? raw["CMT/CCCD"] ?? "").replace(/\s+/g, "");
          if (sourceCard && sourceCard !== worker.idCard) throw new Error("Sai lệch danh tính: CCCD thiếu chữ số; không tự thêm số 0 để gộp hồ sơ");
          const interviewFactory = factories.find((f) => sameFactory(f.name, assignment.interviewFactory));
          // Source imports use interview-factory text for identity; catalog links are optional.
          assignment.interviewFactory = interviewFactory?.name || assignment.interviewFactory;
          assignment.interviewFactoryId = interviewFactory?.id || null;
          assignment.workingFactory = assignment.workingFactory || null;
          assignment.workingFactoryId = null;
          if (assignment.orderId) {
            const order = await prisma.recruitmentOrder.findUnique({ where: { id: assignment.orderId } });
            if (!order) throw new Error("Đơn hàng không tồn tại trong danh mục");
            if (order.factoryId && order.factoryId !== interviewFactory?.id) throw new Error("Nhà máy phỏng vấn không khớp nhà máy của đơn hàng");
            if (assignment.batchId) {
              const batch = await prisma.recruitmentBatch.findUnique({ where: { id: assignment.batchId } });
              if (!batch || batch.orderId !== order.id) throw new Error("Đợt tuyển không thuộc đơn hàng đã chọn");
            }
          } else if (assignment.batchId) {
            throw new Error("Cần chọn đơn hàng trước khi chọn đợt tuyển");
          }
          for (const k of ["orderId", "batchId"])
            if (!assignment[k]) delete assignment[k];

          // 1. Kiểm tra trùng lặp nội bộ trong file (cùng CCCD + Nhà máy PV + Ngày PV)
          const fileKey = `${worker.idCard}|${dateKey(assignment.interviewDate) || ""}`;
          if (seenInFile.has(fileKey)) {
            duplicateCount++;
            errors.push(
              `Dòng ${e.row}: Trùng lặp nội bộ file với dòng ${seenInFile.get(fileKey)} (cùng CCCD ${worker.idCard} và lượt phỏng vấn).`,
            );
            continue;
          }
          seenInFile.set(fileKey, e.row);

          const old = people.get(worker.idCard);
          if (old?.archivedAt)
            throw new Error(
              "Hồ sơ đã lưu trữ, khôi phục trước khi nhập đợt mới",
            );

          // 2. Kiểm tra sai lệch danh tính (cùng CCCD nhưng khác họ tên)
          if (
            old &&
            old.fullName &&
            worker.fullName &&
            identityText(old.fullName) !== identityText(worker.fullName)
          ) {
            duplicateCount++;
            errors.push(
              `Dòng ${e.row}: Sai lệch danh tính — CCCD ${worker.idCard} có họ tên trong file là "${worker.fullName}" nhưng trong CSDL là "${old.fullName}".`,
            );
            continue;
          }

          const phoneMatches = phones.get(phoneKey(worker.phone || ""));
          if (phoneMatches && [...phoneMatches].some(card => card !== worker.idCard)) throw new Error("Trùng SĐT hồ sơ đang hoạt động; cần xác nhận dùng chung số");

          // 3. Kiểm tra trùng lượt tuyển đã có trong CSDL (Smart Merge tự động điền ô trống)
          const dayMatches = (old?.assignments || []).filter((a: any) => sameInterviewDay(a, assignment));
          if (dayMatches.length > 1) throw new Error("Trùng lặp nội bộ: nhiều lượt PV cùng ngày; cần đối chiếu");
          const matchAssignment = dayMatches[0];
          if (matchAssignment && !sameFactory(matchAssignment.interviewFactory, assignment.interviewFactory)) throw new Error("Trùng lặp nội bộ: cùng CCCD và ngày PV nhưng khác nhà máy");

          if (matchAssignment) {
            const workerFillable: Array<keyof typeof worker> = [
              "code",
              "dob",
              "gender",
              "phone",
              "address",
              "province",
              "recruiter",
              "team",
              "source",
              "idCardDate",
              "idCardPlace",
            ];
            const workerUpdates: Record<string, any> = {};
            for (const f of workerFillable) {
              const currentVal = (old as any)?.[f];
              const newVal = worker[f];
              if (
                (!currentVal || String(currentVal).trim() === "") &&
                newVal &&
                String(newVal).trim() !== ""
              ) {
                workerUpdates[f] = newVal;
              }
            }

            const assignmentFillable: Array<keyof typeof assignment> = [
              "contractType",
              "employeeCode",
              "team",
              "startDate",
              "passedDate",
              "onboardingMonth",
              "recruiter",
              "shuttleBusKtx",
              "expectedTrainingDate",
              "expectedTrainingStatus",
              "standardTrainingDate",
              "leaveDate",
              "leaveReason",
            ];
            const assignmentUpdates: Record<string, any> = {};
            for (const f of assignmentFillable) {
              const currentVal = (matchAssignment as any)[f];
              const newVal = assignment[f];
              if (
                (!currentVal || String(currentVal).trim() === "") &&
                newVal &&
                String(newVal).trim() !== ""
              ) {
                assignmentUpdates[f] = newVal;
              }
            }

            if (
              (matchAssignment.interviewResult === "UNKNOWN" ||
                matchAssignment.interviewResult === "PENDING") &&
              assignment.interviewResult &&
              assignment.interviewResult !== "UNKNOWN" &&
              assignment.interviewResult !== "PENDING"
            ) {
              assignmentUpdates.interviewResult = assignment.interviewResult;
            }
            if (
              ((!matchAssignment.status ||
                matchAssignment.status === "Đang chờ phỏng vấn") &&
                assignment.status &&
                assignment.status !== "Đang chờ phỏng vấn") ||
              (!matchAssignment.leaveDate &&
                assignment.leaveDate &&
                assignment.status)
            ) {
              assignmentUpdates.status = assignment.status;
            }

            const rawStk = raw["STK"] || raw["Số tài khoản"];
            const rawBankName = raw["Ngân hàng"];
            const cleanRawStk = rawStk ? String(rawStk).trim() : "";
            const needBankAdd = Boolean(
              cleanRawStk &&
                !old?.bankAccounts?.some(
                  (b: any) => b.accountNumber === cleanRawStk,
                ),
            );

            const updatedFieldKeys = [
              ...Object.keys(workerUpdates).map((k) => labels[k] || k),
              ...Object.keys(assignmentUpdates).map((k) => labels[k] || k),
              ...(needBankAdd ? ["Số tài khoản (STK)"] : []),
            ];

            if (smartMerge && updatedFieldKeys.length > 0) {
              if (Object.keys(workerUpdates).length > 0) {
                Object.assign(old!, workerUpdates);
              }
              if (Object.keys(assignmentUpdates).length > 0) {
                Object.assign(matchAssignment, assignmentUpdates);
              }
              if (commit) {
                const targetWorkerId = old!.id;
                const targetAssignId = matchAssignment.id;
                const isNewlyQueuedWorker = workersToCreate.has(worker.idCard);
                if (isNewlyQueuedWorker && Object.keys(workerUpdates).length > 0) {
                  Object.assign(
                    workersToCreate.get(worker.idCard)!,
                    workerUpdates,
                  );
                }
                updateTasks.push(async (tx) => {
                  if (
                    !isNewlyQueuedWorker &&
                    Object.keys(workerUpdates).length > 0
                  ) {
                    await tx.worker.update({
                      where: { id: targetWorkerId },
                      data: workerUpdates,
                    });
                  }
                  if (
                    !String(targetAssignId).startsWith("preview-") &&
                    Object.keys(assignmentUpdates).length > 0
                  ) {
                    const mergedAssignment = { ...matchAssignment, ...assignmentUpdates };
                    await assignmentRelations(tx, mergedAssignment, matchAssignment);
                    for (const field of ["interviewFactory", "interviewFactoryId", "workingFactory", "workingFactoryId", "status", "statusId"])
                      if (mergedAssignment[field] !== matchAssignment[field]) assignmentUpdates[field] = mergedAssignment[field];
                    await tx.workAssignment.update({
                      where: { id: targetAssignId },
                      data: assignmentUpdates,
                    });
                  }
                  if (needBankAdd) {
                    const hasBank = await tx.bankAccount.findFirst({
                      where: {
                        workerId: targetWorkerId,
                        accountNumber: cleanRawStk,
                      },
                    });
                    if (!hasBank) {
                      await tx.bankAccount.create({
                        data: {
                          workerId: targetWorkerId,
                          accountNumber: cleanRawStk,
                          accountHolderName: worker.fullName || old!.fullName,
                          bankName: rawBankName
                            ? String(rawBankName).trim()
                            : "Ngân hàng đối soát",
                          verificationStatus: "UNVERIFIED",
                          isNameVerified: false,
                          checkResult: "Tự động bổ sung từ file nạp cập nhật",
                        },
                      });
                    }
                  }
                });
              } else {
                readyCount++;
              }
              mergedCount++;
              continue;
            }

            duplicateCount++;
            errors.push(
              `Dòng ${e.row}: Trùng lặp nội bộ — CCCD ${worker.idCard} đã có lượt tuyển tại ${matchAssignment.interviewFactory} (ngày PV: ${matchAssignment.interviewDate || "—"}).`,
            );
            continue;
          }

          const sourceStatus =
            sourceStatuses.includes(assignment.status) &&
            !statusNamesSet.has(assignment.status);
          if (sourceStatus) {
            newStatusesToUpsert.add(assignment.status);
          }

          const canNormalize =
            /^(\d{9}|\d{12})$/.test(worker.idCard) &&
            !!dateKey(assignment.interviewDate) &&
            !!assignment.interviewFactory;

          if (!canNormalize) {
            errorCount++;
            errors.push(
              `Dòng ${e.row}: Thiếu dữ liệu bắt buộc (CCCD 9/12 số, Nhà máy PV hoặc Ngày PV hợp lệ).`,
            );
            continue;
          }

          // Kiểm tra trường hợp công nhân đang làm việc tại công ty khác (CHƯA BÁO NGHỈ)
          if (old) {
            const activeAssign = (old.assignments || []).find((a: any) => isActiveAssignment(a, statuses) && !sameFactory(a.interviewFactory, assignment.interviewFactory));

            if (activeAssign) {
              const currentFac = activeAssign.interviewFactory;
              const newFac = assignment.interviewFactory;
              duplicateCount++;
              errors.push(
                `Dòng ${e.row}: Đang làm việc tại "${currentFac}" (CHƯA BÁO NGHỈ) nhưng phát sinh đợt phỏng vấn/tuyển dụng mới tại "${newFac}".`,
              );
              continue;
            }
          }

          indexPhone({ ...worker, assignments: [assignment] });
          const assignId = crypto.randomUUID();
          let workerId = old?.id;

          if (!old) {
            workerId = crypto.randomUUID();
            const newWorkerRecord = {
              id: workerId,
              ...worker,
              fullName: worker.fullName,
              idCard: worker.idCard,
            };
            workersToCreate.set(worker.idCard, newWorkerRecord);
            people.set(worker.idCard, {
              ...newWorkerRecord,
              assignments: [{ ...assignment, id: assignId, workerId }],
              bankAccounts: [],
              archivedAt: null,
            });
          } else {
            rehireCount++;
            // Tự động điền bù các thông tin cá nhân còn trống vào Worker sẵn có
            const personFillable: Array<keyof typeof worker> = [
              "code",
              "dob",
              "gender",
              "phone",
              "address",
              "province",
              "recruiter",
              "team",
              "source",
              "idCardDate",
              "idCardPlace",
            ];
            const personUpdates: Record<string, any> = {};
            for (const f of personFillable) {
              const cur = (old as any)[f];
              const nxt = worker[f];
              if (
                (!cur || String(cur).trim() === "") &&
                nxt &&
                String(nxt).trim() !== ""
              ) {
                personUpdates[f] = nxt;
              }
            }
            if (Object.keys(personUpdates).length > 0) {
              Object.assign(old, personUpdates);
              if (commit) {
                if (workersToCreate.has(worker.idCard)) {
                  Object.assign(
                    workersToCreate.get(worker.idCard)!,
                    personUpdates,
                  );
                } else {
                  const existingWorkerId = old.id;
                  updateTasks.push(async (tx) => {
                    await tx.worker.update({
                      where: { id: existingWorkerId },
                      data: personUpdates,
                    });
                  });
                }
              }
            }
            old.assignments = old.assignments || [];
            old.assignments.push({ ...assignment, id: assignId, workerId });
          }

          if (commit) {
            assignmentsToCreate.push({
              id: assignId,
              ...assignment,
              interviewFactory: assignment.interviewFactory,
              workerId: workerId!,
            });
            eventsToCreate.push({
              id: crypto.randomUUID(),
              assignmentId: assignId,
              occurredOn: today(),
              toStatus: assignment.status,
              interviewResult: assignment.interviewResult || "UNKNOWN",
              operator: actor.username,
              note: `Import Excel (${fileName} - ${targetSheetName} dòng #${e.row})`,
            });
          } else {
            readyCount++;
          }
        } catch (error: any) {
          errorCount++;
          errors.push(
            `Dòng ${e.row}: ${error.code ? "Không thể lưu dòng dữ liệu" : error.message}`,
          );
        }
      }

      if (commit) {
        for (const st of newStatusesToUpsert) {
          await prisma.laborStatus.upsert({
            where: { name: st },
            create: {
              name: st,
              category: "SOURCE",
              warnsDuplicate: false,
              endsAssignment: false,
            },
            update: {},
          });
        }

        if (assignmentsToCreate.length) {
          const [statusRows, recruiters, teams] = await Promise.all([
            prisma.laborStatus.findMany(),
            prisma.recruiter.findMany({ include: { team: true } }),
            prisma.recruitmentTeam.findMany(),
          ]);
          for (const assignment of assignmentsToCreate) {
          const status = statusRows.find((s) => s.name === assignment.status);
          if (!status) throw new Error(`Trạng thái "${assignment.status}" chưa được tạo trong danh mục`);
          assignment.statusId = status.id;
          if (assignment.recruiter && !assignment.recruiterId) {
            const recruiter = recruiters.find((r) => r.name.trim().toLocaleLowerCase("vi") === String(assignment.recruiter).trim().toLocaleLowerCase("vi"));
            if (recruiter) {
              assignment.recruiterId = recruiter.id;
              if (!assignment.teamId) assignment.teamId = recruiter.teamId;
              if (!assignment.team) assignment.team = recruiter.team?.name || "";
            }
          }
          if (assignment.team && !assignment.teamId) {
            assignment.teamId = teams.find((t) => t.name.trim().toLocaleLowerCase("vi") === String(assignment.team).trim().toLocaleLowerCase("vi"))?.id || null;
          }
          }
        }

        const workerArr = [...workersToCreate.values()];
        const CHUNK = 500;
        for (let i = 0; i < workerArr.length; i += CHUNK) {
          await prisma.worker.createMany({
            data: workerArr.slice(i, i + CHUNK),
          });
        }
        for (let i = 0; i < assignmentsToCreate.length; i += CHUNK) {
          await prisma.workAssignment.createMany({
            data: assignmentsToCreate.slice(i, i + CHUNK),
          });
          successCount += assignmentsToCreate.slice(i, i + CHUNK).length;
        }
        for (let i = 0; i < eventsToCreate.length; i += CHUNK) {
          await prisma.assignmentEvent.createMany({
            data: eventsToCreate.slice(i, i + CHUNK),
          });
        }

        const UPD_CHUNK = 100;
        for (let i = 0; i < updateTasks.length; i += UPD_CHUNK) {
          const part = updateTasks.slice(i, i + UPD_CHUNK);
          await prisma.$transaction(
            async (tx) => {
              for (const t of part) await t(tx);
            },
            { timeout: 60000 },
          );
          successCount += part.length;
        }

        // Nối các bản thưởng chưa có assignmentId với đợt tuyển vừa tạo
        const unlinkedBonuses = await prisma.bonusRecord.findMany({
          where: { assignmentId: null, status: "DRAFT", note: { contains: "SOURCE_EXCEL_ACTUAL_PAID" } },
          select: { id: true, workerId: true, company: true, interviewDate: true, workerCode: true, note: true, updatedAt: true },
        });
        if (unlinkedBonuses.length > 0 && assignmentsToCreate.length > 0) {
          const assignByWorker = new Map<string, any[]>();
          for (const a of assignmentsToCreate) {
            const list = assignByWorker.get(a.workerId) || [];
            list.push(a);
            assignByWorker.set(a.workerId, list);
          }
          const peopleById = new Map([...people.values()].map(person => [person.id, person]));
          const linkTasks: Array<(tx: any) => Promise<void>> = [];
          for (const ub of unlinkedBonuses) {
            const person = peopleById.get(ub.workerId);
            if (!person || !assignByWorker.has(ub.workerId)) continue;
            let matched: any = null;
            try {
              const note = JSON.parse(ub.note || "{}");
              if (note.source !== "SOURCE_EXCEL_ACTUAL_PAID") continue;
              matched = resolveBonusAssignment(person, { company: ub.company, interviewDate: ub.interviewDate,
                workerCode: ub.workerCode, fullName: note.sourceValues?.["Họ tên"] || note.sourceValues?.["Họ và tên"] || person.fullName });
            } catch { /* Keep ambiguous, identity/code-conflicting historical bonuses for explicit review. */ }
            if (matched) {
              linkTasks.push(async (tx) => {
                const changed = await tx.bonusRecord.updateMany({
                  where: { id: ub.id, assignmentId: null, status: "DRAFT", updatedAt: ub.updatedAt },
                  data: { assignmentId: matched.id },
                });
                if (changed.count !== 1) throw new Error("Bản thưởng đã thay đổi trong lúc đối chiếu; thử lại phiên import");
                await tx.auditLog.create({ data: { module: "IMPORT_RECONCILIATION", action: "LINK_BONUS_ON_IMPORT", operator: actor.username,
                  details: JSON.stringify({ bonusId: ub.id, workerId: ub.workerId, beforeAssignmentId: null, afterAssignmentId: matched.id }) } });
              });
            }
          }
          for (let i = 0; i < linkTasks.length; i += 100) {
            const part = linkTasks.slice(i, i + 100);
            await prisma.$transaction(async (tx) => {
              for (const t of part) await t(tx);
            });
          }
        }

        await prisma.auditLog.create({
          data: {
            module: "WORKER",
            action: "IMPORT",
            operator: actor.username,
            details: `Import DS_TONG (${fileName} - ${targetSheetName}): ghi mới ${assignmentsToCreate.length} đợt, bổ sung ${mergedCount} hồ sơ`,
          },
        });
      }

      const review = splitImportReview([...warnings, ...errors]);
      errorCount = splitImportReview(errors).warningRows;
      const sourceId = commit
        ? await saveImportSource(
            "DS_TONG",
            fileName,
            targetSheetName,
            entries,
            warnings,
            errors,
          )
        : null;

      return {
        people,
        entries,
        targetSheetName,
        review,
        sourceId,
        successCount,
        readyCount,
        duplicateCount,
        errorCount,
        rehireCount,
        mergedCount,
        warnings,
        errors,
      };
    }

    // Hàm xử lý Sheet DS_THUONG (nhận preloadedPeople nếu vừa chạy DS_TONG trước đó)
    async function processDsThuongSheet(
      sheetData: SheetEntries,
      preloadedPeople?: Map<string, any>,
    ) {
      const { sheetName: targetSheetName, entries } = sheetData;

      let workerMap: Map<string, any>;
      if (!commit && preloadedPeople) {
        workerMap = preloadedPeople;
      } else {
        const workers = await prisma.worker.findMany({
          include: { assignments: true, bankAccounts: true },
        });
        workerMap = new Map(workers.map((w) => [w.idCard, w]));
      }

      const existingBonuses = await prisma.bonusRecord.findMany({
        select: {
          id: true,
          workerId: true,
          month: true,
          company: true,
          assignmentId: true,
          bonus1: true,
          bonus2: true,
          bonus3: true,
          bonus4: true,
          bonus5: true,
          bonus6: true,
          bonus7: true,
          totalBonus: true,
          policy: true,
          workerCode: true,
          interviewDate: true,
          note: true,
          status: true,
        },
      });
      const bonusMap = new Map<string, (typeof existingBonuses)[0]>();
      const bonusCounts = new Map<string, number>();
      const bonusCompanies = new Map<string, Set<string>>();
      for (const b of existingBonuses) {
        const key = `${b.workerId}|${b.month}|${identityText(b.company)}|${dateKey(b.interviewDate || "")}`;
        bonusCounts.set(key, (bonusCounts.get(key) || 0) + 1);
        const dayKey = b.workerId + "|" + dateKey(b.interviewDate || "");
        const companies = bonusCompanies.get(dayKey) || new Set<string>();
        companies.add(identityText(b.company)); bonusCompanies.set(dayKey, companies);
        bonusMap.set(`${b.workerId}|${b.month}|${identityText(b.company)}|${dateKey(b.interviewDate || "")}`, b);
      }

      let successCount = 0;
      let readyCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;
      let mergedCount = 0;
      const errors: string[] = [];
      const warnings: string[] = [];

      const seenInFile = new Map<string, number>();
      const newWorkerIds = new Set<string>();
      const bonusWorkersToCreate = new Map<string, any>();
      const bonusesToCreate: any[] = [];
      const banksToCreate: any[] = [];
      const scheduledBankKeys = new Set<string>();
      const updateTasks: Array<(tx: any) => Promise<void>> = [];

      for (const e of entries) {
        try {
          const raw = e.raw;
          const parsed = parseBonusImportRow(raw);
          for (const warning of parsed.amountWarnings) warnings.push(`Dòng ${e.row}: ${warning}`);
          const cccdRaw = readBonusValue(raw, "idCard");
          if (!cccdRaw) throw new Error("Thiếu số CCCD");
          const idCard = normalizeCccd(cccdRaw);
          if (String(cccdRaw).replace(/\s+/g, "") !== idCard) throw new Error("Sai lệch danh tính: CCCD thiếu chữ số; cần đối chiếu bản gốc");
          const {
            company,
            month,
            interviewDate,
            policy,
            workerCode,
            fullName,
            accountNumber,
            bankName,
            sequence,
            bonuses,
            totalBonus,
          } = parsed;

          if (!company) throw new Error("Thiếu công ty");
          if (!interviewDate || !dateKey(interviewDate))
            throw new Error("Ngày PV không hợp lệ");

          // 1. Kiểm tra trùng lặp nội bộ trong file
          const fileKey = `${idCard}|${dateKey(interviewDate) || ""}|${month}|${identityText(company)}`;
          if (seenInFile.has(fileKey)) {
            duplicateCount++;
            errors.push(
              `Dòng ${e.row}: Trùng lặp nội bộ file với dòng ${seenInFile.get(fileKey)} (cùng CCCD ${idCard}, tháng ${month}, công ty ${company}).`,
            );
            continue;
          }
          seenInFile.set(fileKey, e.row);

          const [bonus1, bonus2, bonus3, bonus4, bonus5, bonus6, bonus7] =
            bonuses;

          let worker = workerMap.get(idCard);
          const isNewWorker = !worker;
          if (isNewWorker) {
            const denied = await guard(request);
            if (denied) throw new Error("Không có quyền tạo hồ sơ mới từ danh sách thưởng");
            if (!/^(\d{9}|\d{12})$/.test(idCard))
              throw new Error("CCCD phải gồm 9 hoặc 12 chữ số để tạo hồ sơ");
            if (!fullName)
              throw new Error("Thiếu họ tên để tạo hồ sơ lao động");
          }

          assertIdentity(worker, fullName);
          const selectedAssignment = resolveBonusAssignment(worker, { company, interviewDate, workerCode, fullName });
          if (!selectedAssignment) warnings.push(`Dòng ${e.row}: Chưa có lượt PV khớp CCCD và ngày; giữ thưởng chưa liên kết, cần đối chiếu`);

          // 2. Kiểm tra bản thưởng đã có trong CSDL (Smart Merge hoặc Tách trùng an toàn)
          const workerKey = worker?.id || `new:${idCard}`;
          // Use CCCD for file-local identities because preview may assign a temporary worker UUID.
          const fileDayKey = idCard + "|" + dateKey(interviewDate);
          const existingDayKey = workerKey + "|" + dateKey(interviewDate);
          const companies = bonusCompanies.get(fileDayKey) || bonusCompanies.get(existingDayKey) || new Set<string>();
          if ([...companies].some(c => c && c !== identityText(company))) throw new Error("Trùng lặp nội bộ: cùng CCCD và ngày PV nhưng khác công ty trong danh sách thưởng");
          companies.add(identityText(company)); bonusCompanies.set(fileDayKey, companies);
          const bonusKey = `${workerKey}|${month}|${identityText(company)}|${dateKey(interviewDate)}`;
          if ((bonusCounts.get(bonusKey) || 0) > 1) throw new Error("Trùng lặp nội bộ: nhiều bản thưởng cùng lượt và kỳ; cần đối chiếu");
          const existingBonus = bonusMap.get(bonusKey);

          if (existingBonus && !existingBonus.id.startsWith("temp")) {
            if (existingBonus.status && existingBonus.status !== "DRAFT") throw new Error("Bản thưởng của đợt đã có và đã duyệt/khóa; không bổ sung tự động");
            const bonusKeys: Array<
              | "bonus1"
              | "bonus2"
              | "bonus3"
              | "bonus4"
              | "bonus5"
              | "bonus6"
              | "bonus7"
            > = [
              "bonus1",
              "bonus2",
              "bonus3",
              "bonus4",
              "bonus5",
              "bonus6",
              "bonus7",
            ];
            const bonusUpdates: Record<string, number> = {};
            let hasConflictAmount = false;

            bonusKeys.forEach((key, idx) => {
              const oldVal = (existingBonus as any)[key] || 0;
              const newVal = bonuses[idx] || 0;
              if (oldVal === 0 && newVal > 0) {
                bonusUpdates[key] = newVal;
              } else if (oldVal > 0 && newVal > 0 && oldVal !== newVal) {
                hasConflictAmount = true;
              }
            });

            const metadataUpdates: Record<string, any> = {};
            for (const [key, value] of Object.entries({
              company,
              policy,
              workerCode,
              interviewDate,
            })) {
              if (value && !(existingBonus as any)[key])
                metadataUpdates[key] = value;
            }
            if (selectedAssignment && !existingBonus.assignmentId) {
              metadataUpdates.assignmentId = selectedAssignment.id;
            }

            const cleanAcc = accountNumber ? String(accountNumber).trim() : "";
            const cleanBank = bankName ? String(bankName).trim() : "";
            const existingWorkerBank = cleanAcc
              ? worker?.bankAccounts?.find(
                  (b: any) => b.accountNumber === cleanAcc,
                )
              : null;
            const needBankUpdate = Boolean(
              cleanAcc &&
                (!existingWorkerBank ||
                  (cleanBank &&
                    (!existingWorkerBank.bankName ||
                      existingWorkerBank.bankName === "Chưa xác định"))),
            );

            const hasNewBonus =
              !hasConflictAmount &&
              (Object.keys(bonusUpdates).length > 0 ||
                Object.keys(metadataUpdates).length > 0 ||
                needBankUpdate);

            if (smartMerge && hasNewBonus) {
              if (commit) {
                updateTasks.push(async (tx) => {
                  const addedAmount = Object.values(bonusUpdates).reduce(
                    (a, b) => a + b,
                    0,
                  );
                  await tx.bonusRecord.update({
                    where: { id: existingBonus.id },
                    data: {
                      ...bonusUpdates,
                      ...metadataUpdates,
                      totalBonus:
                        (existingBonus.totalBonus || 0) + addedAmount,
                    },
                  });
                  if (cleanAcc && existingBonus.workerId) {
                    const existingBank = await tx.bankAccount.findFirst({
                      where: {
                        workerId: existingBonus.workerId,
                        accountNumber: cleanAcc,
                      },
                    });
                    if (existingBank) {
                      if (
                        cleanBank &&
                        (!existingBank.bankName ||
                          existingBank.bankName === "Chưa xác định")
                      ) {
                        await tx.bankAccount.update({
                          where: { id: existingBank.id },
                          data: { bankName: cleanBank },
                        });
                      }
                    } else {
                      await tx.bankAccount.create({
                        data: {
                          workerId: existingBonus.workerId,
                          accountNumber: cleanAcc,
                          bankName: cleanBank || "Chưa xác định",
                          accountHolderName: fullName,
                          isNameVerified: false,
                          verificationStatus: "UNVERIFIED",
                        },
                      });
                    }
                  }
                });
              } else {
                readyCount++;
              }
              mergedCount++;
              continue;
            }

            duplicateCount++;
            errors.push(
              `Dòng ${e.row}: Bản thưởng của đợt đã có; không tự ghi đè`,
            );
            continue;
          }

          // 3. Nếu là bản ghi thưởng mới hợp lệ
          let targetWorkerId = worker?.id;
          if (!targetWorkerId) {
            newWorkerIds.add(idCard);
            targetWorkerId = crypto.randomUUID();
            const minWorker = {
              id: targetWorkerId,
              idCard,
              fullName,
            };
            bonusWorkersToCreate.set(idCard, minWorker);
            worker = {
              ...minWorker,
              assignments: [],
              bankAccounts: [],
            };
            workerMap.set(idCard, worker);
          }

          bonusMap.set(bonusKey, {
            id: "temp",
            workerId: targetWorkerId,
            month,
            company,
            assignmentId: selectedAssignment?.id || null,
          } as any);

          const sourceNote = JSON.stringify({
            source: "SOURCE_EXCEL_ACTUAL_PAID",
            sequence,
            monthOriginal:
              typeof parsed.monthOriginal === "number"
                ? month
                : parsed.monthOriginal || month,
            sourceValues: raw,
            rewards: parsed.rewardTexts,
            rewardDetails: parsed.rewardDetails,
            paymentDate: null,
            reference: null,
          });

          if (commit) {
            bonusesToCreate.push({
              id: crypto.randomUUID(),
              workerId: targetWorkerId,
              assignmentId:
                selectedAssignment?.id &&
                !String(selectedAssignment.id).startsWith("preview-")
                  ? selectedAssignment.id
                  : null,
              company,
              month,
              interviewDate,
              policy,
              workerCode,
              bonus1,
              bonus2,
              bonus3,
              bonus4,
              bonus5,
              bonus6,
              bonus7,
              totalBonus,
              status: "DRAFT",
              note: sourceNote,
            });

            if (accountNumber) {
              const cleanAcc = String(accountNumber).trim();
              const cleanBank = String(bankName || "").trim();
              const bankKey = `${targetWorkerId}|${cleanAcc}`;
              const existingWorkerBank = worker?.bankAccounts?.find(
                (b: any) => b.accountNumber === cleanAcc,
              );
              if (!existingWorkerBank && !scheduledBankKeys.has(bankKey)) {
                scheduledBankKeys.add(bankKey);
                banksToCreate.push({
                  id: crypto.randomUUID(),
                  workerId: targetWorkerId,
                  accountNumber: cleanAcc,
                  bankName: cleanBank || "Chưa xác định",
                  accountHolderName: fullName || worker?.fullName || "Người lao động",
                  isNameVerified: false,
                  verificationStatus: "UNVERIFIED",
                });
              }
            }
          } else {
            readyCount++;
          }
        } catch (err: any) {
          errorCount++;
          errors.push(`Dòng ${e.row}: ${err.message}`);
        }
      }

      if (commit) {
        const CHUNK = 500;
        const minWorkers = [...bonusWorkersToCreate.values()];
        for (let i = 0; i < minWorkers.length; i += CHUNK) {
          await prisma.worker.createMany({
            data: minWorkers.slice(i, i + CHUNK),
          });
        }
        for (let i = 0; i < bonusesToCreate.length; i += CHUNK) {
          await prisma.bonusRecord.createMany({
            data: bonusesToCreate.slice(i, i + CHUNK),
          });
          successCount += bonusesToCreate.slice(i, i + CHUNK).length;
        }
        for (let i = 0; i < banksToCreate.length; i += CHUNK) {
          await prisma.bankAccount.createMany({
            data: banksToCreate.slice(i, i + CHUNK),
          });
        }

        const UPD_CHUNK = 100;
        for (let i = 0; i < updateTasks.length; i += UPD_CHUNK) {
          const part = updateTasks.slice(i, i + UPD_CHUNK);
          await prisma.$transaction(
            async (tx) => {
              for (const t of part) await t(tx);
            },
            { timeout: 60000 },
          );
          successCount += part.length;
        }

        await prisma.auditLog.create({
          data: {
            module: "BONUS",
            action: "IMPORT",
            operator: actor.username,
            details: `Import DS_THUONG (${fileName} - ${targetSheetName}): ghi mới ${bonusesToCreate.length} bản thưởng, bổ sung ${mergedCount} bản thưởng`,
          },
        });
      }

      const review = splitImportReview([...warnings, ...errors]);
      errorCount = splitImportReview(errors).warningRows;
      const sourceId = commit
        ? await saveImportSource(
            "DS_THUONG",
            fileName,
            targetSheetName,
            entries,
            warnings,
            errors,
          )
        : null;

      return {
        entries,
        targetSheetName,
        review,
        sourceId,
        successCount,
        readyCount,
        newWorkerCount: newWorkerIds.size,
        duplicateCount,
        errorCount,
        mergedCount,
        warnings,
        errors,
      };
    }

    // =========================================================================
    // CHẾ ĐỘ ĐỒNG BỘ LIÊN KẾT CẢ 2 SHEET (DS TỔNG + THƯỞNG) TRONG 1 LẦN GỬI
    // =========================================================================
    if (
      (requestedType === "AUTO" || requestedType === "COMBINED") &&
      foundTongSheet &&
      foundBonusSheet
    ) {
      const workerDenied = await guard(request);
      if (workerDenied) return workerDenied;
      const bonusDenied = await guard(request);
      if (bonusDenied) return bonusDenied;

      const tongData = extractSheetData(
        book,
        foundTongSheet,
        "DS_TONG",
        profile,
      );
      const bonusData = extractSheetData(book, foundBonusSheet, "DS_THUONG");

      if (!tongData || !bonusData) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Không tìm thấy dòng tiêu đề hợp lệ trong sheet DS Tổng hoặc Thưởng",
          },
          { status: 400 },
        );
      }

      const combinedRowError = invalidRowCountResponse(
        tongData.entries.length,
        "Sheet DS Tổng",
      ) || invalidRowCountResponse(bonusData.entries.length, "Sheet thưởng");
      if (combinedRowError) return combinedRowError;

      // Bước 1: Chạy DS Tổng trước để có đầy đủ Hồ sơ Công nhân + Đợt làm việc
      const tongRes = await processDsTongSheet(tongData);
      // Bước 2: Chạy Thưởng ngay sau đó và nối trực tiếp vào Hồ sơ + Đợt vừa tạo
      const bonusRes = await processDsThuongSheet(bonusData, tongRes.people);

      const combinedWarnings = [...tongRes.warnings, ...bonusRes.warnings];
      const combinedErrors = [
        ...tongRes.errors.map((m) => `[${foundTongSheet}] ${m}`),
        ...bonusRes.errors.map((m) => `[${foundBonusSheet}] ${m}`),
      ];
      const combinedReview = {
        warnings: [...tongRes.review.warnings, ...bonusRes.review.warnings],
        duplicates: [
          ...tongRes.review.duplicates.map((d) => ({
            ...d,
            message: `[${foundTongSheet}] ${d.message}`,
          })),
          ...bonusRes.review.duplicates.map((d) => ({
            ...d,
            message: `[${foundBonusSheet}] ${d.message}`,
          })),
        ],
        warningRows:
          tongRes.review.warningRows + bonusRes.review.warningRows,
        duplicateRows:
          tongRes.review.duplicateRows + bonusRes.review.duplicateRows,
        reviewRows: tongRes.review.reviewRows + bonusRes.review.reviewRows,
      };

      const totalRows = tongRes.entries.length + bonusRes.entries.length;
      const totalSuccess = tongRes.successCount + bonusRes.successCount;
      const totalReady = tongRes.readyCount + bonusRes.readyCount;
      const totalMerged = tongRes.mergedCount + bonusRes.mergedCount;
      const totalDuplicates =
        tongRes.review.duplicateRows + bonusRes.review.duplicateRows;
      const totalErrors = tongRes.errorCount + bonusRes.errorCount;

      return NextResponse.json({
        review: combinedReview,
        sourceId: bonusRes.sourceId || tongRes.sourceId,
        normalizedSaved: totalSuccess,
        sourceRowsSaved: commit ? totalRows : 0,
        mainSourceRows: totalRows - combinedReview.duplicateRows,
        pendingDuplicateCount: combinedReview.duplicateRows,
        success: true,
        preview: !commit,
        previewFingerprint,
        importRunId,
        importOptions,
        detectedType: "COMBINED",
        detectedTypeName: `Đồng bộ Liên kết 2 Sheet (${foundTongSheet} + ${foundBonusSheet})`,
        sheetUsed: `${foundTongSheet} (${tongRes.entries.length} dòng) + ${foundBonusSheet} (${bonusRes.entries.length} dòng)`,
        summary: {
          totalRows,
          tongRows: tongRes.entries.length,
          bonusRows: bonusRes.entries.length,
          successCount: commit ? totalSuccess : 0,
          readyCount: commit ? 0 : totalReady,
          newWorkerCount: bonusRes.newWorkerCount,
          duplicateCount: totalDuplicates,
          errorCount: totalErrors,
          warningCount: combinedReview.warningRows,
          cleanCount: totalRows - combinedReview.reviewRows,
          rehireCount: tongRes.rehireCount,
          mergedCount: totalMerged,
        },
        readyRows: [...readyRowSample(tongRes.entries, tongRes.errors), ...readyRowSample(bonusRes.entries, bonusRes.errors)].slice(0, 50),
        normalizationErrors: combinedErrors,
        errors: combinedErrors,
        warnings: combinedWarnings,
        duplicates: combinedReview.duplicates.map((i) => i.message),
      });
    }

    // =========================================================================
    // CHẾ ĐỘ ĐỌC 1 SHEET CỤ THỂ (DS_TONG, DS_THUONG, HOẶC BANK_ACCOUNTS)
    // =========================================================================
    let detectedType: "DS_TONG" | "DS_THUONG" | "BANK_ACCOUNTS" = "DS_TONG";
    let targetSheetName = "";

    if (requestedType === "DS_THUONG" || requestedType === "THUONG") {
      detectedType = "DS_THUONG";
      targetSheetName = foundBonusSheet || sheetNames[0];
    } else if (requestedType === "BANK_ACCOUNTS" || requestedType === "STK") {
      detectedType = "BANK_ACCOUNTS";
      targetSheetName = foundBankSheet || sheetNames[0];
    } else if (requestedType === "DS_TONG") {
      detectedType = "DS_TONG";
      targetSheetName =
        profile?.sheetName || foundTongSheet || sheetNames[0];
    } else {
      if (foundBonusSheet && !foundTongSheet) {
        detectedType = "DS_THUONG";
        targetSheetName = foundBonusSheet;
      } else if (foundBankSheet && !foundTongSheet) {
        detectedType = "BANK_ACCOUNTS";
        targetSheetName = foundBankSheet;
      } else {
        detectedType = "DS_TONG";
        targetSheetName =
          profile?.sheetName || foundTongSheet || sheetNames[0];
      }
    }



    const sheetData = extractSheetData(
      book,
      targetSheetName,
      detectedType,
      profile,
    );
    if (!sheetData) {
      return NextResponse.json(
        {
          success: false,
          message: `Sheet "${targetSheetName}" không có dòng tiêu đề cột hợp lệ. Vui lòng kiểm tra lại.`,
        },
        { status: 400 },
      );
    }

    const rowCountError = invalidRowCountResponse(sheetData.entries.length);
    if (rowCountError) return rowCountError;

    if (detectedType === "DS_THUONG") {
      // Nếu trong file cũng có sheet DS Tổng, tự động nạp DS Tổng trước để không bị thiếu thông tin cá nhân
      let preloadedPeople: Map<string, any> | undefined;
      if (foundTongSheet && foundTongSheet !== targetSheetName) {
        const tongData = extractSheetData(
          book,
          foundTongSheet,
          "DS_TONG",
          profile,
        );
        if (tongData && tongData.entries.length > 0) {
          const tongRowError = invalidRowCountResponse(
            tongData.entries.length,
            "Sheet DS Tổng",
          );
          if (tongRowError) return tongRowError;
          const tongRes = await processDsTongSheet(tongData);
          preloadedPeople = tongRes.people;
        }
      }
      const res = await processDsThuongSheet(sheetData, preloadedPeople);
      return NextResponse.json({
        review: res.review,
        sourceId: res.sourceId,
        normalizedSaved: res.successCount,
        sourceRowsSaved: commit ? res.entries.length : 0,
        mainSourceRows: res.entries.length - res.review.duplicateRows,
        pendingDuplicateCount: res.review.duplicateRows,
        success: true,
        preview: !commit,
        previewFingerprint,
        importRunId,
        importOptions,
        detectedType: "DS_THUONG",
        detectedTypeName: "Bảng thưởng các lần 1 → 7 (DS_THUONG)",
        sheetUsed: res.targetSheetName,
        summary: {
          totalRows: res.entries.length,
          successCount: commit ? res.successCount : 0,
          readyCount: commit ? 0 : res.readyCount,
          newWorkerCount: res.newWorkerCount,
          duplicateCount: res.review.duplicateRows,
          errorCount: res.errorCount,
          warningCount: res.review.warningRows,
          cleanCount: res.entries.length - res.review.reviewRows,
          rehireCount: 0,
          mergedCount: res.mergedCount,
        },
        readyRows: readyRowSample(res.entries, res.errors),
        normalizationErrors: res.errors,
        errors: res.errors,
        warnings: res.review.warnings.map((i) => i.message),
        duplicates: res.review.duplicates.map((i) => i.message),
      });
    }

    if (detectedType === "DS_TONG") {
      const res = await processDsTongSheet(sheetData);
      return NextResponse.json({
        review: res.review,
        sourceId: res.sourceId,
        normalizedSaved: res.successCount,
        sourceRowsSaved: commit ? res.entries.length : 0,
        mainSourceRows: res.entries.length - res.review.duplicateRows,
        pendingDuplicateCount: res.review.duplicateRows,
        success: true,
        preview: !commit,
        previewFingerprint,
        importRunId,
        importOptions,
        detectedType: "DS_TONG",
        detectedTypeName: "Hồ sơ nhân sự tổng (DS_TONG)",
        sheetUsed: res.targetSheetName,
        summary: {
          totalRows: res.entries.length,
          successCount: commit ? res.successCount : 0,
          readyCount: commit ? 0 : res.readyCount,
          duplicateCount: res.review.duplicateRows,
          errorCount: res.errorCount,
          warningCount: res.review.warningRows,
          cleanCount: res.entries.length - res.review.reviewRows,
          rehireCount: res.rehireCount,
          mergedCount: res.mergedCount,
        },
        readyRows: readyRowSample(res.entries, res.errors),
        normalizationErrors: res.errors,
        errors: res.errors,
        warnings: res.review.warnings.map((i) => i.message),
        duplicates: res.review.duplicates.map((i) => i.message),
      });
    }

    // =========================================================================
    // NHÁNH 3: TÀI KHOẢN NGÂN HÀNG (BANK_ACCOUNTS)
    // =========================================================================
    const { entries } = sheetData;
    const workers = await prisma.worker.findMany({
      include: { bankAccounts: true },
    });
    const workerMap = new Map(workers.map((w) => [w.idCard, w]));

    let successCount = 0;
    let readyCount = 0;
    const duplicateCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    const warnings: string[] = [];
    const commitTasks: Array<(tx: any) => Promise<void>> = [];

    for (const e of entries) {
      try {
        const raw = e.raw;
        const cccdRaw =
          raw["CMT/CCCD"] || raw["Số CCCD"] || raw["số CCCD"] || raw["CCCD"];
        if (!cccdRaw) throw new Error("Thiếu số CMT/CCCD");
        const idCard = normalizeCccd(cccdRaw);
        const fullName = String(
          raw["Họ và tên"] || raw["Họ tên"] || raw["Tên chủ tài khoản"] || "",
        ).trim();
        const stkRaw = raw["STK"] || raw["Số tài khoản"];
        if (!stkRaw) throw new Error("Thiếu số tài khoản (STK)");
        const accountNumber = String(stkRaw).trim();
        const accountHolderName = String(
          raw["Tên chủ tài khoản"] || fullName,
        ).trim();
        const bankName = String(
          raw["Ngân hàng"] || "Ngân hàng đối soát",
        ).trim();
        const statusSTK = String(
          raw["Tình trạng STK"] || raw["TT"] || "",
        ).trim();
        const warningMsg = String(raw["Cảnh báo"] || "").trim();
        const checkedBy = String(raw["Người check"] || "").trim();
        const checkResult = String(
          raw["Kết Quả"] || raw["Kết quả"] || "",
        ).trim();

        const isMatch =
          statusSTK.toLowerCase().includes("hợp lệ") ||
          checkResult.toLowerCase().includes("khớp") ||
          !warningMsg;
        const verificationStatus = "UNVERIFIED";

        let worker = workerMap.get(idCard);
        if (
          worker?.bankAccounts.some((a) => a.accountNumber === accountNumber)
        )
          throw new Error("STK trùng hồ sơ đã có — giữ riêng chờ kiểm tra");

        if (commit) {
          commitTasks.push(async (tx) => {
            if (!worker) {
              worker = await tx.worker.create({
                data: {
                  idCard,
                  fullName: fullName || accountHolderName || "Người lao động",
                  phone: raw["SĐT"] ? String(raw["SĐT"]).trim() : null,
                  dob: raw["Ngày sinh"]
                    ? String(raw["Ngày sinh"]).trim()
                    : null,
                },
                include: { bankAccounts: true },
              });
              workerMap.set(idCard, worker);
            }

            await tx.bankAccount.create({
              data: {
                workerId: worker.id,
                accountNumber,
                accountHolderName,
                bankName,
                isNameVerified: false,
                verificationStatus,
                warningMessage: warningMsg || null,
                checkedBy: checkedBy || null,
                checkResult: checkResult || null,
                checkedAt: new Date(),
              },
            });
          });
        } else {
          readyCount++;
        }
      } catch (err: any) {
        errorCount++;
        errors.push(`Dòng ${e.row}: ${err.message}`);
      }
    }

    if (commit && commitTasks.length > 0) {
      const BATCH_SIZE = 100;
      for (let i = 0; i < commitTasks.length; i += BATCH_SIZE) {
        const chunk = commitTasks.slice(i, i + BATCH_SIZE);
        await prisma.$transaction(
          async (tx) => {
            for (const task of chunk) await task(tx);
          },
          { timeout: 60000 },
        );
        successCount += chunk.length;
      }
    }

    const review = splitImportReview([...warnings, ...errors]);
      errorCount = splitImportReview(errors).warningRows;
    const sourceId = commit
      ? await saveImportSource(
          detectedType,
          fileName,
          targetSheetName,
          entries,
          warnings,
          errors,
        )
      : null;

    return NextResponse.json({
      review,
      sourceId,
      normalizedSaved: successCount,
      sourceRowsSaved: commit ? entries.length : 0,
      mainSourceRows: entries.length - review.duplicateRows,
      pendingDuplicateCount: review.duplicateRows,
      success: true,
      preview: !commit,
        previewFingerprint,
        importRunId,
        importOptions,
      detectedType: "BANK_ACCOUNTS",
      detectedTypeName: "Đối soát số tài khoản ngân hàng (STK)",
      sheetUsed: targetSheetName,
      summary: {
        totalRows: entries.length,
        successCount: commit ? successCount : 0,
        readyCount: commit ? 0 : readyCount,
        duplicateCount: review.duplicateRows,
        errorCount,
        warningCount: review.warningRows,
        cleanCount: entries.length - review.reviewRows,
        rehireCount: 0,
      },
      readyRows: readyRowSample(entries, errors),
      normalizationErrors: errors,
      errors,
      warnings: review.warnings.map((i) => i.message),
      duplicates: review.duplicates.map((i) => i.message),
    });
    };
    if (!commit) return await execute();
    return await runRecoverableImport(database, { runId: importRunId, signature, operator: actor.username }, async (tx, stageSource) => {
      prisma = tx;
      saveImportSource = stageSource;
      return execute();
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        importRunId: err?.importRunId,
        recoveryState: err?.recoveryState,
        message:
          (err?.importRunId ? "" : "Không thể đọc file Excel. ") +
          (err?.message || "Kiểm tra định dạng và thử lại."),
      },
      { status: err?.status || 400 },
    );
  }
}
