import { splitImportReview } from "@/lib/import-review";
import { saveImportSource } from "@/lib/import-source-store";
import { sourceStatuses } from "@/lib/source-format";
import {
  dateKey,
  phoneKey,
  normalizeCccd,
} from "@/lib/worker-validation";
import { matchFactory } from "@/lib/factory-matching";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import { guard, identity } from "@/lib/auth";
import { parseImportRow } from "@/lib/worker-import";
import { parseBonusImportRow, readBonusValue } from "@/lib/bonus-import";
import { today, day } from "@/lib/domain";
import crypto from "node:crypto";

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

  const entries = matrix
    .slice(headerRowIndex + 1)
    .map((values, index) => ({
      row: headerRowIndex + index + 2,
      raw: Object.fromEntries(headers.map((h, i) => [h, values[i]])),
      values,
    }))
    .filter((e) => e.values.some((v) => String(v ?? "").trim() !== ""));

  return {
    sheetName: targetSheetName,
    headers,
    entries,
  };
}

export async function POST(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const form = await request.formData();
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
        });
        if (!gRes.ok) {
          return NextResponse.json(
            {
              success: false,
              message:
                'Không thể tải bảng tính từ Google Sheets. Vui lòng đảm bảo bảng tính đã được mở quyền "Bất kỳ ai có đường liên kết đều có thể xem".',
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

    const commit = form.get("confirm") === "true";
    const smartMerge = form.get("smartMerge") !== "false";
    const actor = (await identity(request))!;
    const requestedType = String(
      form.get("importType") || "AUTO",
    ).toUpperCase();

    const book = XLSX.read(fileBuffer, { type: "buffer" });
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
      const m = XLSX.utils.sheet_to_json<any[]>(s, {
        header: 1,
        defval: "",
        blankrows: false,
      });
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
      const statusNamesSet = new Set(statuses.map((s) => s.name));
      const identityKey = (a: any) =>
        [
          a.interviewFactory,
          a.interviewDate ? day(a.interviewDate, "Ngày PV") : null,
          a.employeeCode || "",
        ].join("|");

      const labels: Record<string, string> = {
        fullName: "Họ và tên",
        idCard: "số CCCD",
        interviewFactory: "Nhà máy PV",
        workingFactory: "Nhà máy làm việc",
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
          for (const k of ["orderId", "batchId"])
            if (!assignment[k]) delete assignment[k];

          // 1. Kiểm tra trùng lặp nội bộ trong file (cùng CCCD + Nhà máy PV + Ngày PV)
          const fileKey = `${worker.idCard}|${assignment.interviewFactory || ""}|${dateKey(assignment.interviewDate) || ""}`;
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
            old.fullName.trim().toLocaleLowerCase("vi") !==
              worker.fullName.trim().toLocaleLowerCase("vi")
          ) {
            duplicateCount++;
            errors.push(
              `Dòng ${e.row}: Sai lệch danh tính — CCCD ${worker.idCard} có họ tên trong file là "${worker.fullName}" nhưng trong CSDL là "${old.fullName}".`,
            );
            continue;
          }

          // 3. Kiểm tra trùng lượt tuyển đã có trong CSDL (Smart Merge tự động điền ô trống)
          const matchAssignment = old?.assignments?.find(
            (a: any) =>
              identityKey(a) === identityKey(assignment) ||
              (a.interviewFactory === assignment.interviewFactory &&
                dateKey(a.interviewDate) === dateKey(assignment.interviewDate)) ||
              (assignment.employeeCode &&
                a.employeeCode === assignment.employeeCode &&
                a.interviewFactory === assignment.interviewFactory),
          );

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
              "workingFactory",
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
            const activeAssign = (old.assignments || []).find((a: any) => {
              if (a.leaveDate) return false;
              if (a.leaveReason) return false;
              const s = (a.status || "").toLowerCase().trim();
              const isInactive =
                !s ||
                s === "đã nghỉ việc" ||
                s === "nghỉ việc" ||
                s === "nghỉ hẳn" ||
                s === "nh" ||
                s === "bỏ xx" ||
                s === "bỏ xưởng" ||
                s === "hết hạn hợp đồng" ||
                s === "hết hợp đồng" ||
                s === "hhđ" ||
                s === "tự ý nghỉ việc" ||
                s.includes("nghỉ") ||
                s.includes("hết phí") ||
                s.includes("bỏ xx") ||
                s.includes("bỏ xưởng") ||
                s.includes("bỏ việc") ||
                s.includes("ko theo dõi") ||
                s.includes("không theo dõi") ||
                s.includes("hết hợp đồng") ||
                s.includes("hết hạn") ||
                s.includes("hhđ") ||
                s.includes("kết thúc") ||
                s.includes("(nh)") ||
                s.includes("(bỏ xx)");
              if (isInactive) return false;
              const curFactory = a.workingFactory || a.interviewFactory || "";
              const nxtFactory = assignment.workingFactory || assignment.interviewFactory || "";
              return curFactory && nxtFactory && !matchFactory(curFactory, nxtFactory);
            });

            if (activeAssign) {
              const currentFac = activeAssign.workingFactory || activeAssign.interviewFactory;
              const newFac = assignment.interviewFactory || assignment.workingFactory;
              duplicateCount++;
              errors.push(
                `Dòng ${e.row}: Đang làm việc tại "${currentFac}" (CHƯA BÁO NGHỈ) nhưng phát sinh đợt phỏng vấn/tuyển dụng mới tại "${newFac}".`,
              );
              continue;
            }
          }

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
          where: { assignmentId: null },
          select: { id: true, workerId: true, company: true, interviewDate: true },
        });
        if (unlinkedBonuses.length > 0 && assignmentsToCreate.length > 0) {
          const assignByWorker = new Map<string, any[]>();
          for (const a of assignmentsToCreate) {
            const list = assignByWorker.get(a.workerId) || [];
            list.push(a);
            assignByWorker.set(a.workerId, list);
          }
          const linkTasks: Array<(tx: any) => Promise<void>> = [];
          for (const ub of unlinkedBonuses) {
            const cands = assignByWorker.get(ub.workerId) || [];
            const matched = cands.find(
              (a) =>
                matchFactory(
                  ub.company || "",
                  a.workingFactory || a.interviewFactory || "",
                ) &&
                (!ub.interviewDate ||
                  !a.interviewDate ||
                  dateKey(ub.interviewDate) === dateKey(a.interviewDate)),
            );
            if (matched) {
              linkTasks.push(async (tx) => {
                await tx.bonusRecord.update({
                  where: { id: ub.id },
                  data: { assignmentId: matched.id },
                });
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
        },
      });
      const bonusMap = new Map<string, (typeof existingBonuses)[0]>();
      for (const b of existingBonuses) {
        bonusMap.set(
          `${b.workerId}|${b.month}|${b.company || ""}|${b.assignmentId || ""}`,
          b,
        );
        bonusMap.set(`${b.workerId}|${b.month}|${b.company || ""}|`, b);
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
          const cccdRaw = readBonusValue(raw, "idCard");
          if (!cccdRaw) throw new Error("Thiếu số CCCD");
          const idCard = normalizeCccd(cccdRaw);
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
          if (interviewDate && !dateKey(interviewDate))
            throw new Error("Ngày PV không hợp lệ");

          // 1. Kiểm tra trùng lặp nội bộ trong file
          const fileKey = `${idCard}|${month}|${company}`;
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
            if (!/^(\d{9}|\d{12})$/.test(idCard))
              throw new Error("CCCD phải gồm 9 hoặc 12 chữ số để tạo hồ sơ");
            if (!fullName)
              throw new Error("Thiếu họ tên để tạo hồ sơ lao động");
          }

          let candidates = (worker?.assignments || []).filter(
            (a: any) =>
              matchFactory(a.interviewFactory, company) ||
              matchFactory(a.workingFactory, company),
          );
          if (workerCode) {
            const codeMatches = candidates.filter(
              (a: any) =>
                a.employeeCode === workerCode || worker?.code === workerCode,
            );
            if (codeMatches.length) candidates = codeMatches;
          }
          if (dateKey(interviewDate)) {
            const dateMatches = candidates.filter(
              (a: any) =>
                dateKey(a.interviewDate || "") === dateKey(interviewDate),
            );
            if (dateMatches.length) candidates = dateMatches;
          }
          const selectedAssignment =
            candidates.length >= 1 ? candidates[0] : null;

          // 2. Kiểm tra bản thưởng đã có trong CSDL (Smart Merge hoặc Tách trùng an toàn)
          const workerKey = worker?.id || `new:${idCard}`;
          const bonusKey = `${workerKey}|${month}|${company}|${selectedAssignment?.id || ""}`;
          const existingBonus =
            bonusMap.get(bonusKey) ||
            (selectedAssignment
              ? bonusMap.get(`${workerKey}|${month}|${company}|`)
              : undefined) ||
            existingBonuses.find(
              (b) =>
                worker &&
                b.workerId === worker.id &&
                b.month === month &&
                (b.company || "") === company &&
                (selectedAssignment
                  ? b.assignmentId === selectedAssignment.id || !b.assignmentId
                  : !b.assignmentId),
            );

          if (existingBonus && !existingBonus.id.startsWith("temp")) {
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
                          isNameVerified: true,
                          verificationStatus: "VERIFIED",
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
            rewards: Array.from({ length: 7 }, (_, i) =>
              String(readBonusValue(raw, `bonus${i + 1}`) ?? ""),
            ),
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
                  isNameVerified: true,
                  verificationStatus: "VERIFIED",
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
      const workerDenied = await guard(request, "worker:write");
      if (workerDenied) return workerDenied;
      const bonusDenied = await guard(request, "bonus:write");
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
        (tongRes.duplicateCount || tongRes.review.duplicateRows) +
        (bonusRes.duplicateCount || bonusRes.review.duplicateRows);
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

    const typeDenied = await guard(
      request,
      detectedType === "DS_THUONG"
        ? "bonus:write"
        : detectedType === "BANK_ACCOUNTS"
          ? "bank:write"
          : "worker:write",
    );
    if (typeDenied) return typeDenied;

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

    if (!sheetData.entries.length || sheetData.entries.length > 50000) {
      return NextResponse.json(
        { success: false, message: "File cần từ 1 đến 50.000 dòng dữ liệu" },
        { status: 400 },
      );
    }

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
        detectedType: "DS_THUONG",
        detectedTypeName: "Bảng thưởng các lần 1 → 7 (DS_THUONG)",
        sheetUsed: res.targetSheetName,
        summary: {
          totalRows: res.entries.length,
          successCount: commit ? res.successCount : 0,
          readyCount: commit ? 0 : res.readyCount,
          newWorkerCount: res.newWorkerCount,
          duplicateCount: res.duplicateCount || res.review.duplicateRows,
          errorCount: res.errorCount,
          warningCount: res.review.warningRows,
          cleanCount: res.entries.length - res.review.reviewRows,
          rehireCount: 0,
          mergedCount: res.mergedCount,
        },
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
        detectedType: "DS_TONG",
        detectedTypeName: "Hồ sơ nhân sự tổng (DS_TONG)",
        sheetUsed: res.targetSheetName,
        summary: {
          totalRows: res.entries.length,
          successCount: commit ? res.successCount : 0,
          readyCount: commit ? 0 : res.readyCount,
          duplicateCount: res.duplicateCount || res.review.duplicateRows,
          errorCount: res.errorCount,
          warningCount: res.review.warningRows,
          cleanCount: res.entries.length - res.review.reviewRows,
          rehireCount: res.rehireCount,
          mergedCount: res.mergedCount,
        },
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
        const verificationStatus = isMatch ? "VALID" : "UNVERIFIED";

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
                isNameVerified: isMatch,
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
      detectedType: "BANK_ACCOUNTS",
      detectedTypeName: "Đối soát số tài khoản ngân hàng (STK)",
      sheetUsed: targetSheetName,
      summary: {
        totalRows: entries.length,
        successCount: commit ? successCount : 0,
        readyCount: commit ? 0 : readyCount,
        duplicateCount: duplicateCount || review.duplicateRows,
        errorCount,
        warningCount: review.warningRows,
        cleanCount: entries.length - review.reviewRows,
        rehireCount: 0,
      },
      normalizationErrors: errors,
      errors,
      warnings: review.warnings.map((i) => i.message),
      duplicates: review.duplicates.map((i) => i.message),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Không thể đọc file Excel. " +
          (err?.message || "Kiểm tra định dạng và thử lại."),
      },
      { status: 400 },
    );
  }
}
