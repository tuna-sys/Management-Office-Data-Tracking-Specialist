import { splitImportReview } from "@/lib/import-review";
import { saveImportSource } from "@/lib/import-source-store";
import { sourceStatuses } from "@/lib/source-format";
import { dateKey } from "@/lib/worker-validation";
import { matchFactory } from "@/lib/factory-matching";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import { guard, identity } from "@/lib/auth";
import { phoneKey, normalizeCccd } from "@/lib/worker-validation";
import { parseImportRow } from "@/lib/worker-import";
import { parseBonusImportRow, readBonusValue } from "@/lib/bonus-import";
import { assignmentRelations, today, day } from "@/lib/domain";

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
      const gidMatch = googleSheetUrl.match(/[#&?]gid=(\d+)/);
      const gid = gidMatch ? gidMatch[1] : "";
      const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx${gid ? `&gid=${gid}` : ""}`;

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
    const confirmPhone = form.get("confirmPhoneDuplicate") === "true";
    const confirmActive = form.get("confirmActiveDuplicate") === "true";
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

    // --- 1. Tự Động Nhận Diện Loại File (Smart Auto-Detect) ---
    let detectedType: "DS_TONG" | "DS_THUONG" | "BANK_ACCOUNTS" = "DS_TONG";
    let targetSheetName = "";

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
      for (const row of m.slice(0, 5)) {
        const rowStr = (row || [])
          .map((v: any) => String(v).trim().toLowerCase())
          .join(" ");
        if (
          rowStr.includes("cccd") ||
          rowStr.includes("họ tên") ||
          rowStr.includes("thưởng") ||
          rowStr.includes("stk")
        ) {
          h = (row || []).map((v: any) => String(v).trim());
          break;
        }
      }
      if (!h.length && m[0]) {
        h = (m[0] || []).map((v: any) => String(v).trim());
      }
      sheetHeadersMap.set(sName, h);
    }

    if (requestedType === "DS_THUONG" || requestedType === "THUONG") {
      detectedType = "DS_THUONG";
    } else if (requestedType === "BANK_ACCOUNTS" || requestedType === "STK") {
      detectedType = "BANK_ACCOUNTS";
    } else if (requestedType === "DS_TONG") {
      detectedType = "DS_TONG";
    } else {
      // Tự động nhận diện (AUTO DETECT)
      const bonusSheet = sheetNames.find(
        (s) =>
          s.toUpperCase().includes("THUONG") ||
          s.toUpperCase().includes("THƯỞNG"),
      );
      const bankSheet = sheetNames.find(
        (s) =>
          s.toUpperCase().includes("STK") ||
          s.toUpperCase().includes("NGÂN HÀNG") ||
          s.toUpperCase().includes("NGAN HANG"),
      );

      let hasBonusHeaders = false;
      let hasBankHeaders = false;

      for (const [sName, headers] of sheetHeadersMap.entries()) {
        const headerStr = headers.join(" ").toLowerCase();
        if (
          headerStr.includes("thưởng lần 1") ||
          (headerStr.includes("chính sách") &&
            headerStr.includes("tổng thưởng"))
        ) {
          hasBonusHeaders = true;
          targetSheetName = sName;
          break;
        }
        if (
          headerStr.includes("tình trạng stk") ||
          headerStr.includes("người check") ||
          (headerStr.includes("stk") && headerStr.includes("tên chủ tài khoản"))
        ) {
          hasBankHeaders = true;
          targetSheetName = sName;
          break;
        }
      }

      if (
        hasBonusHeaders ||
        (bonusSheet &&
          !sheetHeadersMap
            .get(bonusSheet || "")
            ?.some((h) => h.includes("Nhà máy PV")))
      ) {
        detectedType = "DS_THUONG";
        targetSheetName = targetSheetName || bonusSheet || sheetNames[0];
      } else if (hasBankHeaders || bankSheet) {
        detectedType = "BANK_ACCOUNTS";
        targetSheetName = targetSheetName || bankSheet || sheetNames[0];
      } else {
        detectedType = "DS_TONG";
        targetSheetName =
          profile?.sheetName ||
          (sheetNames.includes("DS_TONG") ? "DS_TONG" : sheetNames[0]);
      }
    }

    if (!targetSheetName) {
      if (detectedType === "DS_THUONG") {
        targetSheetName =
          sheetNames.find(
            (s) =>
              s.toUpperCase().includes("THUONG") ||
              s.toUpperCase().includes("THƯỞNG"),
          ) || sheetNames[0];
      } else if (detectedType === "BANK_ACCOUNTS") {
        targetSheetName =
          sheetNames.find((s) => s.toUpperCase().includes("STK")) ||
          sheetNames[0];
      } else {
        targetSheetName =
          profile?.sheetName ||
          (sheetNames.includes("DS_TONG") ? "DS_TONG" : sheetNames[0]);
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
    const sheet = book.Sheets[targetSheetName];
    if (!sheet) {
      return NextResponse.json(
        {
          success: false,
          message: `Không tìm thấy sheet ${targetSheetName} phù hợp trong file Excel. Vui lòng kiểm tra lại.`,
        },
        { status: 400 },
      );
    }

    const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: true,
    });

    // Tìm dòng tiêu đề hợp lệ trong 10 dòng đầu
    let headerRowIndex = -1;
    let headers: string[] = [];

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

    const targetKeywords = headerKeywordsByType[detectedType] || [
      "cccd",
      "họ tên",
      "họ và tên",
    ];

    for (let rIdx = 0; rIdx < Math.min(matrix.length, 10); rIdx++) {
      const row = matrix[rIdx];
      if (!Array.isArray(row) || !row.length) continue;
      const rowStrArr = row.map((v) => String(v ?? "").trim());
      const rowLower = rowStrArr.map((v) => v.toLowerCase());

      // Nếu dòng chứa dữ liệu cá nhân rõ ràng (như dãy 9-12 số của CCCD hoặc số điện thoại), chắc chắn đây không phải dòng tiêu đề
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

    if (headerRowIndex === -1) {
      return NextResponse.json(
        {
          success: false,
          message:
            "File Excel không có dòng tiêu đề cột hợp lệ (thiếu các cột bắt buộc như Họ tên, CCCD...). Vui lòng kiểm tra lại hàng đầu tiên của file.",
        },
        { status: 400 },
      );
    }

    const entries = matrix
      .slice(headerRowIndex + 1)
      .map((values, index) => ({
        row: headerRowIndex + index + 2,
        raw: Object.fromEntries(headers.map((h, i) => [h, values[i]])),
        values,
      }))
      .filter((e) => e.values.some((v) => String(v ?? "").trim() !== ""));

    if (!entries.length || entries.length > 50000) {
      return NextResponse.json(
        { success: false, message: "File cần từ 1 đến 50.000 dòng dữ liệu" },
        { status: 400 },
      );
    }

    let successCount = 0;
    let readyCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    let rehireCount = 0;
    let mergedCount = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    // =========================================================================
    // NHÁNH 1: BẢNG THƯỞNG (DS_THUONG)
    // =========================================================================
    if (detectedType === "DS_THUONG") {
      const workers = await prisma.worker.findMany({
        include: { assignments: true },
      });
      const workerMap = new Map(workers.map((w) => [w.idCard, w]));

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
          accountNumber: true,
          bankName: true,
          interviewDate: true,
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

      const seenInFile = new Map<string, number>();
      const commitTasks: Array<(tx: any) => Promise<void>> = [];
      const newWorkerIds = new Set<string>();

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
            amountWarnings,
          } = parsed;
          for (const warning of amountWarnings)
            warnings.push(`Dòng ${e.row}: ${warning}`);
          if (!company) throw new Error("Thiếu công ty");
          if (typeof cccdRaw === "number")
            warnings.push(
              `Dòng ${e.row}: CCCD là dữ liệu số; kiểm tra lại số 0 đầu trong file gốc.`,
            );
          if (interviewDate && !dateKey(interviewDate))
            throw new Error("Ngày PV không hợp lệ");
          if (typeof readBonusValue(raw, "accountNumber") === "number")
            warnings.push(
              `Dòng ${e.row}: STK là dữ liệu số; nếu file có số 0 đầu, hãy định dạng cột STK là Text để bảo toàn.`,
            );

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
            warnings.push(
              `Dòng ${e.row}: CCCD chưa có hồ sơ; khi xác nhận sẽ tạo hồ sơ tối thiểu từ họ tên và CCCD. Bản thưởng chưa gắn đợt tuyển để đối chiếu.`,
            );
          }
          let candidates = (worker?.assignments || []).filter(
            (a) =>
              matchFactory(a.interviewFactory, company) ||
              matchFactory(a.workingFactory, company),
          );
          if (workerCode) {
            const codeMatches = candidates.filter(
              (a) =>
                a.employeeCode === workerCode || worker?.code === workerCode,
            );
            if (codeMatches.length) candidates = codeMatches;
          }
          if (dateKey(interviewDate)) {
            const dateMatches = candidates.filter(
              (a) => dateKey(a.interviewDate || "") === dateKey(interviewDate),
            );
            if (dateMatches.length) candidates = dateMatches;
          }
          let selectedAssignment = null;
          if (candidates.length === 1) {
            selectedAssignment = candidates[0];
          } else if (!isNewWorker) {
            warnings.push(
              `Dòng ${e.row}: ${candidates.length ? "Có nhiều đợt tuyển phù hợp" : "Không tìm thấy đợt tuyển phù hợp"}; bản thưởng sẽ được lưu chưa gắn đợt để đối chiếu.`,
            );
          }

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
            // Kiểm tra xem có lần thưởng nào mới để bổ sung (Smart Merge) hay không
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

            bonusKeys.forEach((key, idx) => {
              const oldVal = (existingBonus as any)[key] || 0;
              const newVal = bonuses[idx] || 0;
              if (oldVal === 0 && newVal > 0) {
                bonusUpdates[key] = newVal;
              }
            });

            const metadataUpdates: Record<string, string> = {};
            for (const [key, value] of Object.entries({
              company,
              policy,
              workerCode,
              interviewDate,
              accountNumber,
              bankName,
            })) {
              if (value && !(existingBonus as any)[key])
                metadataUpdates[key] = value;
            }
            const hasNewBonus =
              Object.keys(bonusUpdates).length > 0 ||
              Object.keys(metadataUpdates).length > 0;

            if (smartMerge && hasNewBonus) {
              if (commit) {
                commitTasks.push(async (tx) => {
                  const addedAmount = Object.values(bonusUpdates).reduce(
                    (a, b) => a + b,
                    0,
                  );
                  await tx.bonusRecord.update({
                    where: { id: existingBonus.id },
                    data: {
                      ...bonusUpdates,
                      ...metadataUpdates,
                      totalBonus: (existingBonus.totalBonus || 0) + addedAmount,
                    },
                  });
                  await tx.auditLog.create({
                    data: {
                      module: "BONUS",
                      action: "UPDATE",
                      operator: actor.username,
                      details: `Dòng ${e.row}: Bổ sung thưởng đợt ${month} cho CCCD ${idCard} (${company})`,
                    },
                  });
                });
              } else {
                readyCount++;
              }
              mergedCount++;
              continue;
            }

            // Nếu không có thông tin mới để bổ sung: Tách riêng vào luồng trùng, KHÔNG throw làm hỏng các dòng khác
            duplicateCount++;
            errors.push(
              `Dòng ${e.row}: Bản thưởng của đợt đã có; không tự ghi đè`,
            );
            continue;
          }

          // 3. Nếu là bản ghi mới hợp lệ:
          if (isNewWorker) newWorkerIds.add(idCard);
          bonusMap.set(bonusKey, {
            id: "temp",
            workerId: workerKey,
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
            commitTasks.push(async (tx) => {
              let workerId = worker?.id;
              if (!workerId) {
                let createdWorker = await tx.worker.findUnique({
                  where: { idCard },
                });
                if (createdWorker) {
                  if (
                    createdWorker.fullName.trim().toLocaleLowerCase("vi") !==
                    fullName.toLocaleLowerCase("vi")
                  )
                    throw new Error(
                      `Tên không khớp hồ sơ CCCD ${idCard}; cần xác minh trước khi nhập`,
                    );
                  workerId = createdWorker.id;
                } else {
                  createdWorker = await tx.worker.create({
                    data: { idCard, fullName },
                  });
                  workerId = createdWorker.id;
                  await tx.auditLog.create({
                    data: {
                      module: "WORKER",
                      action: "IMPORT",
                      operator: actor.username,
                      details: `Tạo hồ sơ tối thiểu từ file DS_THUONG cho CCCD ${idCard}`,
                    },
                  });
                }
              }
              await tx.bonusRecord.create({
                data: {
                  workerId,
                  assignmentId: selectedAssignment?.id || null,
                  company,
                  month,
                  interviewDate,
                  policy,
                  workerCode,
                  accountNumber: accountNumber || null,
                  bankName: bankName || null,
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
                },
              });
              await tx.auditLog.create({
                data: {
                  module: "BONUS",
                  action: "IMPORT",
                  operator: actor.username,
                  details: `Dòng ${e.row}: CCCD ${idCard}, công ty ${company}, tháng ${month}, thưởng ${totalBonus.toLocaleString("vi-VN")} đ`,
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

      if (commit && newWorkerIds.size) {
        const workerDenied = await guard(request, "worker:write");
        if (workerDenied) return workerDenied;
      }

      if (commit && commitTasks.length > 0) {
        const BATCH_SIZE = 100;
        for (let i = 0; i < commitTasks.length; i += BATCH_SIZE) {
          const chunk = commitTasks.slice(i, i + BATCH_SIZE);
          try {
            await prisma.$transaction(
              async (tx) => {
                for (const task of chunk) {
                  await task(tx);
                }
              },
              { timeout: 60000 },
            );
            successCount += chunk.length;
          } catch (chunkErr) {
            for (const task of chunk) {
              try {
                await prisma.$transaction(
                  async (tx) => {
                    await task(tx);
                  },
                  { timeout: 15000 },
                );
                successCount++;
              } catch (singleErr: any) {
                errorCount++;
                errors.push(
                  `Lỗi ghi dòng: ${singleErr?.message || "Không xác định"}`,
                );
              }
            }
          }
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
        detectedType: "DS_THUONG",
        detectedTypeName: "Bảng thưởng các lần 1 → 7 (DS_THUONG)",
        sheetUsed: targetSheetName,
        summary: {
          totalRows: entries.length,
          successCount: commit ? successCount : 0,
          readyCount: commit ? 0 : readyCount,
          newWorkerCount: newWorkerIds.size,
          duplicateCount: duplicateCount || review.duplicateRows,
          errorCount,
          warningCount: review.warningRows,
          cleanCount: entries.length - review.reviewRows,
          rehireCount,
          mergedCount,
        },
        normalizationErrors: errors,
        errors,
        warnings: review.warnings.map((i) => i.message),
        duplicates: review.duplicates.map((i) => i.message),
      });
    }

    // =========================================================================
    // NHÁNH 2: TÀI KHOẢN NGÂN HÀNG (BANK_ACCOUNTS)
    // =========================================================================
    if (detectedType === "BANK_ACCOUNTS") {
      const workers = await prisma.worker.findMany({
        include: { bankAccounts: true },
      });
      const workerMap = new Map(workers.map((w) => [w.idCard, w]));

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
          if (!worker) {
            warnings.push(
              `Dòng ${e.row}: CCCD ${idCard} chưa có trong hồ sơ, hệ thống sẽ tự động tạo hồ sơ cơ bản.`,
            );
          }

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

              const existingBank = await tx.bankAccount.findFirst({
                where: {
                  workerId: worker.id,
                  accountNumber,
                },
              });

              if (existingBank) {
                await tx.bankAccount.update({
                  where: { id: existingBank.id },
                  data: {
                    accountHolderName,
                    bankName,
                    isNameVerified: isMatch,
                    verificationStatus,
                    warningMessage: warningMsg || null,
                    checkedBy: checkedBy || existingBank.checkedBy,
                    checkResult: checkResult || existingBank.checkResult,
                    checkedAt: new Date(),
                  },
                });
              } else {
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
              }

              await tx.auditLog.create({
                data: {
                  module: "FINANCE",
                  action: "IMPORT",
                  operator: actor.username,
                  details: `Dòng ${e.row}: Cập nhật STK ${accountNumber} (${accountHolderName}) cho CCCD ${idCard}`,
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
          try {
            await prisma.$transaction(
              async (tx) => {
                for (const task of chunk) {
                  await task(tx);
                }
              },
              { timeout: 60000 },
            );
            successCount += chunk.length;
          } catch (chunkErr) {
            for (const task of chunk) {
              try {
                await prisma.$transaction(
                  async (tx) => {
                    await task(tx);
                  },
                  { timeout: 15000 },
                );
                successCount++;
              } catch (singleErr: any) {
                errorCount++;
                errors.push(
                  `Lỗi ghi dòng: ${singleErr?.message || "Không xác định"}`,
                );
              }
            }
          }
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
          rehireCount,
        },
        normalizationErrors: errors,
        errors,
        warnings: review.warnings.map((i) => i.message),
        duplicates: review.duplicates.map((i) => i.message),
      });
    }

    // =========================================================================
    // NHÁNH 3: HỒ SƠ TỔNG MASTER DATA (DS_TONG)
    // =========================================================================
    if (
      new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Tên cột bị trùng; cần ánh xạ đúng cột trước khi nhập",
        },
        { status: 400 },
      );
    }

    const mapping = profile ? JSON.parse(profile.mappingJson) : null;
    const existing = await prisma.worker.findMany({
      include: { assignments: true, bankAccounts: true },
    });
    const people = new Map(existing.map((w) => [w.idCard, w]));
    const statuses = await prisma.laborStatus.findMany({
      where: { isActive: true },
    });
    const warns = new Set(
      statuses.filter((s) => s.warnsDuplicate).map((s) => s.name),
    );
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

    const activeWorkerByPhone = new Map<
      string,
      { idCard: string; fullName: string }
    >();
    for (const w of people.values()) {
      if (w.archivedAt || !w.phone) continue;
      const pk = phoneKey(w.phone);
      if (!pk) continue;
      const isActive = w.assignments.some(
        (a: any) =>
          warns.has(a.status) ||
          (!a.leaveDate &&
            ["đang làm việc", "đang lv", "hết phí", "chưa đào tạo", "lv"].some(
              (s) => (a.status || "").toLowerCase().includes(s),
            )),
      );
      if (isActive && !activeWorkerByPhone.has(pk)) {
        activeWorkerByPhone.set(pk, { idCard: w.idCard, fullName: w.fullName });
      }
    }

    const seenInFile = new Map<string, number>();
    const commitTasks: Array<(tx: any) => Promise<void>> = [];

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
        if (
          assignment.interviewResult === "PASS" &&
          !raw["Ngày đỗ"] &&
          !raw["Ngày PV đỗ"]
        ) {
          warnings.push(
            `Dòng ${e.row}: nguồn xác nhận Đỗ, ngày đỗ dùng ngày PV; kiểm tra ở bước xem trước.`,
          );
        }
        const rowWarnings: string[] = [];
        try {
          parseImportRow(raw);
        } catch (issue: any) {
          rowWarnings.push(issue.message);
          warnings.push(
            `Dòng ${e.row}: giữ thông tin nguồn, cần kiểm tra: ${issue.message}`,
          );
        }
        if (!assignment.interviewDate || !dateKey(assignment.interviewDate))
          warnings.push(
            `Dòng ${e.row}: Cần ngày PV để lưu đúng lượt tuyển và báo cáo`,
          );
        if (
          !statuses.some((s) => s.name === assignment.status) &&
          !sourceStatuses.includes(assignment.status)
        )
          warnings.push(
            `Dòng ${e.row}: Trạng thái chưa có trong danh mục: ${assignment.status}`,
          );
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
          throw new Error("Hồ sơ đã lưu trữ, khôi phục trước khi nhập đợt mới");

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

        // 3. Kiểm tra trùng lượt tuyển đã có trong CSDL (Bổ sung thông tin còn thiếu hoặc cảnh báo trùng)
        const matchAssignment = old?.assignments.find(
          (a) =>
            identityKey(a) === identityKey(assignment) ||
            (a.interviewFactory === assignment.interviewFactory &&
              dateKey(a.interviewDate) === dateKey(assignment.interviewDate)) ||
            (assignment.employeeCode &&
              a.employeeCode === assignment.employeeCode &&
              a.interviewFactory === assignment.interviewFactory),
        );

        if (matchAssignment) {
          // Kiểm tra xem file có trường thông tin nào mới để bổ sung (Smart Merge) hay không
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

          // Bổ sung kết quả PV / Tình trạng nếu đợt cũ đang ở trạng thái chờ/chưa rõ
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
            (!matchAssignment.status ||
              matchAssignment.status === "Đang chờ phỏng vấn") &&
            assignment.status &&
            assignment.status !== "Đang chờ phỏng vấn"
          ) {
            assignmentUpdates.status = assignment.status;
          }

          const rawStk = raw["STK"] || raw["Số tài khoản"];
          const rawBankName = raw["Ngân hàng"];
          const needBankAdd = Boolean(
            rawStk &&
            String(rawStk).trim() &&
            (!old?.bankAccounts || old.bankAccounts.length === 0),
          );

          const updatedFieldKeys = [
            ...Object.keys(workerUpdates).map((k) => labels[k] || k),
            ...Object.keys(assignmentUpdates).map((k) => labels[k] || k),
            ...(needBankAdd ? ["Số tài khoản (STK)"] : []),
          ];

          if (smartMerge && updatedFieldKeys.length > 0) {
            if (commit) {
              commitTasks.push(async (tx) => {
                if (Object.keys(workerUpdates).length > 0) {
                  await tx.worker.update({
                    where: { id: old!.id },
                    data: workerUpdates,
                  });
                  Object.assign(old!, workerUpdates);
                }
                if (Object.keys(assignmentUpdates).length > 0) {
                  await tx.workAssignment.update({
                    where: { id: matchAssignment.id },
                    data: assignmentUpdates,
                  });
                  Object.assign(matchAssignment, assignmentUpdates);
                }
                if (needBankAdd) {
                  const hasBank = await tx.bankAccount.findFirst({
                    where: {
                      workerId: old!.id,
                      accountNumber: String(rawStk).trim(),
                    },
                  });
                  if (!hasBank) {
                    await tx.bankAccount.create({
                      data: {
                        workerId: old!.id,
                        accountNumber: String(rawStk).trim(),
                        accountHolderName: worker.fullName || old!.fullName,
                        bankName: rawBankName
                          ? String(rawBankName).trim()
                          : "Ngân hàng đối soát",
                        verificationStatus: "UNVERIFIED",
                        isNameVerified: false,
                        checkResult: "Tự động bổ sung từ file nạp cập nhật",
                      },
                    });
                    if (old) {
                      (old as any).bankAccounts =
                        (old as any).bankAccounts || [];
                      (old as any).bankAccounts.push({
                        accountNumber: String(rawStk).trim(),
                      });
                    }
                  }
                }
                await tx.assignmentEvent.create({
                  data: {
                    assignmentId: matchAssignment.id,
                    occurredOn: today(),
                    toStatus:
                      assignmentUpdates.status || matchAssignment.status,
                    interviewResult:
                      assignmentUpdates.interviewResult ||
                      matchAssignment.interviewResult,
                    operator: actor.username,
                    note: `Smart Merge: Bổ sung thông tin từ Excel (${fileName}) — ${updatedFieldKeys.join(", ")}`,
                  },
                });
                await tx.auditLog.create({
                  data: {
                    module: "WORKER",
                    action: "UPDATE",
                    operator: actor.username,
                    details: `Dòng ${e.row}: Bổ sung thông tin cho hồ sơ ${worker.idCard} (${old!.fullName}), đợt ${matchAssignment.interviewFactory}: ${updatedFieldKeys.join(", ")}`,
                  },
                });
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

        // 4. Cảnh báo nghiệp vụ (không chặn nạp): Chưa báo nghỉ & Trùng SĐT
        const activeAssignment = old?.assignments.find(
          (a) =>
            warns.has(a.status) ||
            (!a.leaveDate &&
              [
                "đang làm việc",
                "đang lv",
                "hết phí",
                "chưa đào tạo",
                "lv",
              ].some((s) => (a.status || "").toLowerCase().includes(s))),
        );
        if (activeAssignment) {
          const actFactory =
            activeAssignment.workingFactory ||
            activeAssignment.interviewFactory ||
            "Xưởng cũ";
          warnings.push(
            `Dòng ${e.row}: [CHƯA BÁO NGHỈ] Đang làm việc tại ${actFactory} nhưng đăng ký PV tại ${assignment.interviewFactory || "xưởng mới"}.`,
          );
        }

        const matchPhone = worker.phone
          ? activeWorkerByPhone.get(phoneKey(worker.phone))
          : null;
        const activePhoneWorker =
          matchPhone && matchPhone.idCard !== worker.idCard ? matchPhone : null;
        if (activePhoneWorker) {
          warnings.push(
            `Dòng ${e.row}: [CHÚ Ý SĐT] SĐT ${worker.phone} đang trùng với công nhân ${activePhoneWorker.fullName} (${activePhoneWorker.idCard}).`,
          );
        }

        const sourceStatus =
          sourceStatuses.includes(assignment.status) &&
          !statuses.some((s) => s.name === assignment.status);
        if (sourceStatus)
          warnings.push(
            `Dòng ${e.row}: giữ nguyên mã tình trạng nguồn ${assignment.status}; chưa diễn giải.`,
          );

        if (commit) {
          const canNormalize =
            /^(\d{9}|\d{12})$/.test(worker.idCard) &&
            !!dateKey(assignment.interviewDate) &&
            !!assignment.interviewFactory;
          if (canNormalize) {
            commitTasks.push(async (tx) => {
              if (sourceStatus)
                await tx.laborStatus.upsert({
                  where: { name: assignment.status },
                  create: {
                    name: assignment.status,
                    category: "SOURCE",
                    warnsDuplicate: false,
                    endsAssignment: false,
                  },
                  update: {},
                });
              let person = await tx.worker.findUnique({
                where: { idCard: worker.idCard },
                include: { assignments: true },
              });
              if (!person)
                person = await tx.worker.create({
                  data: {
                    ...worker,
                    fullName: worker.fullName,
                    idCard: worker.idCard,
                  },
                  include: { assignments: true },
                });
              const a = await tx.workAssignment.create({
                data: {
                  ...assignment,
                  interviewFactory: assignment.interviewFactory,
                  workerId: person.id,
                },
              });
              await tx.assignmentEvent.create({
                data: {
                  assignmentId: a.id,
                  occurredOn: today(),
                  toStatus: a.status,
                  interviewResult: a.interviewResult,
                  operator: actor.username,
                  note:
                    "Import Excel — source:" +
                    JSON.stringify({
                      row: e.row,
                      sheet: targetSheetName,
                      file: fileName,
                      values: raw,
                      warnings: rowWarnings,
                    }),
                },
              });
              await tx.auditLog.create({
                data: {
                  module: "WORKER",
                  action: "IMPORT",
                  operator: actor.username,
                  details: `Dòng ${e.row}: hồ sơ ${person.id}, lượt ${a.id}${old ? " (thêm lịch sử vào hồ sơ cũ)" : ""}`,
                },
              });
            });
          } else {
            errors.push(
              `Dòng ${e.row}: Không thể chuẩn hóa vào hồ sơ: ${rowWarnings.join("; ") || "Dữ liệu chưa hợp lệ"}`,
            );
          }
        } else {
          readyCount++;
        }

        if (old) {
          rehireCount++;
          old.assignments.push({
            ...assignment,
            id: "preview-" + e.row,
          } as any);
        } else {
          people.set(worker.idCard, {
            ...worker,
            id: "preview-" + e.row,
            assignments: [{ ...assignment, id: "preview-" + e.row }],
            archivedAt: null,
          } as any);
        }
      } catch (error: any) {
        errorCount++;
        errors.push(
          `Dòng ${e.row}: ${error.code ? "Không thể lưu dòng dữ liệu" : error.message}`,
        );
      }
    }

    if (commit && commitTasks.length > 0) {
      const BATCH_SIZE = 100;
      for (let i = 0; i < commitTasks.length; i += BATCH_SIZE) {
        const chunk = commitTasks.slice(i, i + BATCH_SIZE);
        try {
          await prisma.$transaction(
            async (tx) => {
              for (const task of chunk) {
                await task(tx);
              }
            },
            { timeout: 60000 },
          );
          successCount += chunk.length;
        } catch (chunkErr) {
          for (const task of chunk) {
            try {
              await prisma.$transaction(
                async (tx) => {
                  await task(tx);
                },
                { timeout: 15000 },
              );
              successCount++;
            } catch (singleErr: any) {
              errorCount++;
              errors.push(
                `Lỗi ghi dòng: ${singleErr?.message || "Không xác định"}`,
              );
            }
          }
        }
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
      detectedType: "DS_TONG",
      detectedTypeName: "Hồ sơ nhân sự tổng (DS_TONG)",
      sheetUsed: targetSheetName,
      summary: {
        totalRows: entries.length,
        successCount: commit ? successCount : 0,
        readyCount: commit ? 0 : readyCount,
        duplicateCount: duplicateCount || review.duplicateRows,
        errorCount,
        warningCount: review.warningRows,
        cleanCount: entries.length - review.reviewRows,
        rehireCount,
        mergedCount,
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
