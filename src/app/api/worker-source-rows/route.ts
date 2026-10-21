import { cachedRead } from "@/lib/read-cache";
import { readDataVersion } from "@/lib/read-data-version";
import { splitImportReview } from "@/lib/import-review";
import { dateKey } from "@/lib/worker-validation";
import { matchFactory, cleanFactory } from "@/lib/factory-matching";
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/local-request";
import { prisma } from "@/lib/prisma";
import { readImportSources } from "@/lib/import-source-store";
import {
  normalizeWorkerSourceValues,
  workerSourceView,
} from "@/lib/worker-source-view";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

async function buildWorkerRows(archived: boolean) {
    const resolvedPath = path.resolve(".local/resolved-duplicates.json");
    const resolvedIds = new Set<string>(
      existsSync(resolvedPath)
        ? JSON.parse(readFileSync(resolvedPath, "utf8"))
        : [],
    );

    const [sources, workers, approveLogs] = await Promise.all([
      readImportSources(),
      prisma.worker.findMany({
        where: {
          archivedAt:
            archived
              ? { not: null }
              : null,
        },
        include: {
          assignments: {
            include: {
              events: {
                where: { note: { startsWith: "Import Excel — source:" } },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { note: true },
              },
              bonusRecords: { select: { status: true, approvedAt: true } },
            },
          },
          bankAccounts: true,
        },
      }),
      prisma.auditLog.findMany({
        where: { action: "APPROVE", module: "DUPLICATE" },
        select: { details: true },
      }),
    ]);

    interface ApproveLogInfo {
      card: string;
      rowNum?: number;
      sourceType?: string;
    }
    const parsedApproveLogs: ApproveLogInfo[] = [];
    for (const log of approveLogs) {
      const cardMatch = /\b(\d{9}|\d{12})\b/.exec(log.details || "");
      const rowMatch = /dòng #(\d+)/i.exec(log.details || "");
      const typeMatch = /\((DS_TONG|DS_THUONG)\)/i.exec(log.details || "");
      parsedApproveLogs.push({
        card: cardMatch ? cardMatch[1] : "",
        rowNum: rowMatch ? Number(rowMatch[1]) : undefined,
        sourceType: typeMatch ? typeMatch[1].toUpperCase() : undefined,
      });
    }

    const people = new Map(workers.map((w) => [w.idCard, w]));
    const assignmentValues = (a: any) => ({
      id: a.id,
      updatedAt: a.updatedAt,
      contractType: a.contractType,
      status: a.status,
      interviewFactory: a.interviewFactory,
      leaveDate: a.leaveDate,
      leaveReason: a.leaveReason,
      shuttleBusKtx: a.shuttleBusKtx,
      interviewDate: a.interviewDate,
      expectedTrainingDate: a.expectedTrainingDate,
      expectedTrainingStatus: a.expectedTrainingStatus,
      standardTrainingDate: a.standardTrainingDate,
      onboardingMonth: a.onboardingMonth,
      employeeCode: a.employeeCode,
      recruiter: a.recruiter,
      recruiterId: a.recruiterId,
      team: a.team,
      teamId: a.teamId,
      orderId: a.orderId,
      batchId: a.batchId,
      interviewResult: a.interviewResult,
      passedDate: a.passedDate,
      startDate: a.startDate,
      confirmedWorkDays: a.confirmedWorkDays,
      workDaysAsOf: a.workDaysAsOf,
      source: a.source,
    });
    const workerValues = (w: any) => ({
      code: w.code,
      fullName: w.fullName,
      dob: w.dob,
      gender: w.gender,
      idCard: w.idCard,
      idCardDate: w.idCardDate,
      idCardPlace: w.idCardPlace,
      phone: w.phone,
      address: w.address,
      province: w.province,
      recruiter: w.recruiter,
      team: w.team,
      source: w.source,
    });

    const bonusRows = sources
      .filter((s) => s.type === "DS_THUONG")
      .sort(
        (a, b) =>
          a.file.localeCompare(b.file, "vi") ||
          a.createdAt.localeCompare(b.createdAt),
      )
      .flatMap((s) =>
        s.rows
          .filter(
            (r: any) =>
              !splitImportReview([
                ...(r.warnings || []),
                ...(r.duplicates || []),
              ]).duplicates.length,
          )
          .map((r: any) => ({
            ...r,
            id: `${s.id}-${r.row}`,
            values: normalizeWorkerSourceValues(r.values),
            file: s.file,
          })),
      );

    const stored = sources
      .filter((s) => s.type === "DS_TONG")
      .sort(
        (a, b) =>
          a.file.localeCompare(b.file, "vi") ||
          a.createdAt.localeCompare(b.createdAt),
      );

    const sourceRows = stored.flatMap((s) =>
      s.rows.map((r: any) => {
        const values = normalizeWorkerSourceValues(r.values);
        const card = String(
          values["Số CCCD"] || values["số CCCD"] || values.CCCD || "",
        ).trim();
        const worker = people.get(card);
        const rev = splitImportReview([
          ...(r.warnings || []),
          ...(r.duplicates || []),
        ]);
        const cleanAssignments = worker
          ? worker.assignments.map(assignmentValues)
          : [];
        const cleanBanks = worker?.bankAccounts
          ? worker.bankAccounts.map((b: any) => ({
              accountNumber: b.accountNumber,
              bankName: b.bankName,
              accountHolderName: b.accountHolderName,
            }))
          : [];
        const alertId = `import-${s.id}-${r.row}`;
        const pvDate = String(values["Ngày PV"] || "");
        const code = String(values["Mã NV"] || "");
        const factory = String(values["Nhà máy PV"] || "");

        const matchedAssignment =
          worker?.assignments?.find((a: any) => {
            if (!matchFactory(a.interviewFactory || "", factory)) return false;
            if (
              pvDate &&
              a.interviewDate &&
              dateKey(a.interviewDate) !== dateKey(pvDate)
            )
              return false;
            if (
              code &&
              a.employeeCode &&
              String(a.employeeCode).trim() !== code.trim()
            )
              return false;
            return true;
          }) ||
          worker?.assignments?.find((a: any) => {
            if (!matchFactory(a.interviewFactory || "", factory)) return false;
            if (
              pvDate &&
              a.interviewDate &&
              dateKey(a.interviewDate) === dateKey(pvDate)
            )
              return true;
            return false;
          });

        const isDirectApproved =
          Boolean(r.isApproved) || resolvedIds.has(alertId);
        const isExplicitLogRow = parsedApproveLogs.some(
          (l) =>
            l.rowNum === Number(r.row) &&
            (l.sourceType === "DS_TONG" || !l.sourceType) &&
            (!l.card || l.card === card),
        );
        const isAssignmentApproved = Boolean(
          matchedAssignment?.events?.some((e: any) =>
            /duyệt.*(trùng|bổ sung|ghi đè|chính thức)|duyệt cảnh báo/i.test(
              e.note || "",
            ),
          ) ||
          matchedAssignment?.bonusRecords?.some(
            (b: any) => b.status === "APPROVED" || Boolean(b.approvedAt),
          ),
        );
        const isDuplicateLogCardMatch = parsedApproveLogs.some(
          (l) =>
            Boolean(l.card && l.card === card) &&
            code &&
            !["bỏ đt", "chưa có mã", "chưa có"].includes(code.toLowerCase()),
        );

        const isApproved =
          isDirectApproved ||
          isExplicitLogRow ||
          isAssignmentApproved ||
          isDuplicateLogCardMatch;

        return {
          id: `source-${s.id}-${r.row}`,
          sourceId: s.id,
          sourceValues: values,
          sourceWarnings: rev.warnings.map((i) => i.message),
          sourceDuplicates: rev.duplicates.map((i) => i.message),
          sourceFile: s.file,
          sourceRow: r.row,
          workerId: worker?.id,
          fullName: values["Họ và tên"],
          idCard: card,
          updatedAt: worker?.updatedAt,
          workerValues: worker ? workerValues(worker) : null,
          assignments: cleanAssignments,
          bankAccounts: cleanBanks,
          isSourceRow: true,
          isApproved,
        };
      }),
    );

    const pendingDuplicateRows = sourceRows.filter(
      (r) => r.sourceDuplicates.length > 0,
    );
    const unmergedSourceRows = sourceRows.filter(
      (r) => !r.sourceDuplicates.length,
    );

    const scoreCandidateRow = (row: any): number => {
      let score = 0;
      if (row.isApproved) score += 1000;
      const status = String(row.sourceValues?.["Tình trạng"] || "")
        .toLowerCase()
        .trim();
      const trainStatus = String(row.sourceValues?.["Tình trạng đào tạo"] || "")
        .toLowerCase()
        .trim();
      const code = String(row.sourceValues?.["Mã NV"] || "")
        .trim()
        .toLowerCase();

      // Active / successful recruitment
      if (
        [
          "nh",
          "lv",
          "đang làm việc",
          "làm việc",
          "ok",
          "hết phí",
          "đi làm",
        ].some((s) => status.includes(s) || trainStatus.includes(s))
      ) {
        score += 500;
      }
      // Negative / dropped / failed
      if (
        [
          "bỏ đt",
          "bỏ đào tạo",
          "trượt",
          "k đạt",
          "không đạt",
          "hủy",
          "ko đi làm",
          "nghỉ việc",
        ].some((s) => status.includes(s) || trainStatus.includes(s))
      ) {
        score -= 300;
      }
      // Real employee code
      if (
        code &&
        !["bỏ đt", "chưa có mã", "chưa có", "—", "-", ""].includes(code)
      ) {
        score += 200;
      }
      // Later interview date preferred
      const pv = String(row.sourceValues?.["Ngày PV"] || "");
      const d = dateKey(pv);
      if (d) {
        const time = new Date(d).getTime();
        if (!isNaN(time)) score += Math.floor(time / 86400000) / 1000;
      }
      return score;
    };

    const mainSourceRows: any[] = [];
    const groupedByWorkerFactoryMonth = new Map<string, any[]>();

    for (const r of unmergedSourceRows) {
      const card = r.idCard;
      if (!card) {
        mainSourceRows.push(r);
        continue;
      }
      const factory = cleanFactory(r.sourceValues?.["Nhà máy PV"] || "");
      const m =
        dateKey(String(r.sourceValues?.["Ngày PV"] || ""))?.slice(0, 7) ||
        dateKey(String(r.sourceValues?.["Ngày NH"] || ""))?.slice(0, 7) ||
        String(r.sourceValues?.["Tháng nhận việc"] || "")
          .trim()
          .toLowerCase();
      const day = dateKey(String(r.sourceValues?.["Ngày PV"] || ""));
      const groupKey = day
        ? `${card}|${day}`
        : `${card}|${factory}|${m}|${r.id}`;

      let list = groupedByWorkerFactoryMonth.get(groupKey);
      if (!list) {
        list = [];
        groupedByWorkerFactoryMonth.set(groupKey, list);
      }
      list.push(r);
    }

    for (const group of groupedByWorkerFactoryMonth.values()) {
      if (group.length === 1) {
        mainSourceRows.push(group[0]);
        continue;
      }
      const sorted = [...group].sort(
        (a, b) => scoreCandidateRow(b) - scoreCandidateRow(a),
      );
      const winner = sorted[0];
      const losers = sorted.slice(1);

      const previousAttempts = losers.map((l) => ({
        sourceRow: l.sourceRow,
        interviewDate: l.sourceValues?.["Ngày PV"] || "—",
        status: l.sourceValues?.["Tình trạng"] || "—",
        trainingStatus: l.sourceValues?.["Tình trạng đào tạo"] || "—",
        employeeCode: l.sourceValues?.["Mã NV"] || "—",
        note: `Đợt trước ngày ${l.sourceValues?.["Ngày PV"] || "—"}: ${l.sourceValues?.["Tình trạng"] || "Bỏ ĐT"} (Đã gộp vào đợt chính thức)`,
      }));

      const anyApproved = group.some((item) => item.isApproved);
      mainSourceRows.push({
        ...winner,
        isApproved: winner.isApproved || anyApproved,
        previousAttempts,
      });
    }

    // The recruitment identity is CCCD + interview day; company/code can change after review.
    const sourceKey = (card: string, v: any) => {
      const day = dateKey(String(v["Ngày PV"] || ""));
      return day && card
        ? [card.replace(/\s+/g, ""), day].join("|")
        : [
            card,
            String(v["Nhà máy PV"] || ""),
            String(v["Ngày PV"] || ""),
            String(v["Mã NV"] || ""),
          ].join("|");
    };
    const visibleRecruitments = new Set<string>();
    const currentSourceRows = mainSourceRows
      .map((r) => {
        const worker = people.get(r.idCard);
        const day = dateKey(String(r.sourceValues["Ngày PV"] || ""));
        const assignment = day
          ? worker?.assignments.find((a) => dateKey(a.interviewDate) === day)
          : null;
        if (!worker || !assignment) return r;
        return {
          ...r,
          sourceValues: workerSourceView(worker, assignment, true).values,
          assignments: [assignmentValues(assignment)],
        };
      })
      .filter((r) => {
        const key = sourceKey(r.idCard, r.sourceValues);
        if (visibleRecruitments.has(key)) return false;
        visibleRecruitments.add(key);
        return true;
      });

    const sourcedKeys = new Set(
      currentSourceRows.map((r) => sourceKey(r.idCard, r.sourceValues)),
    );

    const canonical = workers
      .flatMap((w) =>
        w.assignments.map((a) => {
          const source = workerSourceView(w, a, true);
          const rev = splitImportReview(source.warnings);
          const hasApprovalEvent = a.events?.some((e: any) =>
            /duyệt.*(trùng|bổ sung|ghi đè|chính thức)|duyệt cảnh báo/i.test(
              e.note || "",
            ),
          );
          const hasApprovedBonus = a.bonusRecords?.some(
            (b: any) => b.status === "APPROVED" || Boolean(b.approvedAt),
          );
          const hasDuplicateLog = parsedApproveLogs.some(
            (l) => l.card && l.card === w.idCard,
          );
          const isApproved =
            Boolean(hasApprovalEvent) ||
            Boolean(hasApprovedBonus) ||
            Boolean(hasDuplicateLog) ||
            resolvedIds.has(`${w.id}-${a.id}`);
          return {
            id: `${w.id}-${a.id}`,
            workerId: w.id,
            fullName: w.fullName,
            idCard: w.idCard,
            phone: w.phone,
            assignments: [
              {
                ...assignmentValues(a),
              },
            ],
            updatedAt: w.updatedAt,
            workerValues: workerValues(w),
            assignmentCount: w.assignments.length,
            bankAccounts: w.bankAccounts
              ? w.bankAccounts.map((b: any) => ({
                  accountNumber: b.accountNumber,
                  bankName: b.bankName,
                  accountHolderName: b.accountHolderName,
                }))
              : [],
            sourceValues: source.values,
            sourceWarnings: rev.warnings.map((i) => i.message),
            sourceDuplicates: rev.duplicates.map((i) => i.message),
            sourceFile: source.hasSource
              ? "Import trước khi lưu bản nguồn"
              : "Hồ sơ nội bộ",
            isApproved,
          };
        }),
      )
      .filter((r) => !sourcedKeys.has(sourceKey(r.idCard, r.sourceValues)));

    const bonusRowsByCccd = new Map<string, any[]>();
    for (const b of bonusRows) {
      const card = String(
        b.values["Số CCCD"] || b.values["số CCCD"] || b.values.CCCD || "",
      ).trim();
      if (!card) continue;
      let list = bonusRowsByCccd.get(card);
      if (!list) {
        list = [];
        bonusRowsByCccd.set(card, list);
      }
      list.push(b);
    }

    // Đếm số đợt làm việc/phỏng vấn của từng CCCD (trong CSDL và trong các nguồn Excel)
    const returningCards = new Set<string>();
    const cardAttemptCount = new Map<string, number>();

    for (const w of workers) {
      if (w.idCard && w.assignments && w.assignments.length >= 2) {
        returningCards.add(w.idCard);
        cardAttemptCount.set(w.idCard, w.assignments.length);
      }
    }

    const cardBatches = new Map<string, Set<string>>();
    for (const r of unmergedSourceRows) {
      const card = r.idCard;
      if (!card) continue;
      const fac = cleanFactory(r.sourceValues?.["Nhà máy PV"] || "");
      const d =
        dateKey(String(r.sourceValues?.["Ngày PV"] || "")) ||
        String(r.sourceValues?.["Ngày PV"] || "");
      const key = d || `${fac}|${r.id}`;
      let s = cardBatches.get(card);
      if (!s) {
        s = new Set();
        cardBatches.set(card, s);
      }
      s.add(key);
    }

    for (const [card, s] of cardBatches.entries()) {
      const currentCount = cardAttemptCount.get(card) || 0;
      const total = Math.max(currentCount, s.size);
      cardAttemptCount.set(card, total);
      if (total >= 2) {
        returningCards.add(card);
      }
    }

    const rows = [...currentSourceRows, ...canonical].map((r) => {
      const candidateBonuses = bonusRowsByCccd.get(r.idCard);
      let rewardSource = candidateBonuses
        ? candidateBonuses.filter((b) =>
            matchFactory(
              String(b.values["Công ty"] || ""),
              String(r.sourceValues["Nhà máy PV"] || ""),
            ),
          )
        : [];
      if (rewardSource.length > 1) {
        const rowCode = String(r.sourceValues?.["Mã NV"] || "")
          .trim()
          .toLowerCase();
        const rowDate = dateKey(String(r.sourceValues?.["Ngày PV"] || ""));
        const exactMatches = rewardSource.filter((b) => {
          const bCode = String(
            b.values?.["Mã nhân viên"] || b.values?.["Mã NV"] || "",
          )
            .trim()
            .toLowerCase();
          const bDate = dateKey(String(b.values?.["Ngày PV"] || ""));
          if (rowCode && bCode && rowCode === bCode) return true;
          if (rowDate && bDate && rowDate === bDate) return true;
          return false;
        });
        if (exactMatches.length > 0) {
          rewardSource = exactMatches;
        }
      }

      const isRet =
        returningCards.has(r.idCard) ||
        Boolean(r.previousAttempts && r.previousAttempts.length > 0) ||
        Boolean(r.assignmentCount && r.assignmentCount >= 2);
      const rehireCount =
        cardAttemptCount.get(r.idCard) ||
        (r.previousAttempts
          ? r.previousAttempts.length + 1
          : r.assignmentCount || (isRet ? 2 : 1));

      return {
        ...r,
        rewardSource,
        isReturning: Boolean(isRet),
        rehireCount,
      };
    });

    const linkedRewards = new Set(
      rows.flatMap((r) => r.rewardSource.map((b) => b.id)),
    );
    const unlinkedBonusRows = bonusRows.filter((b) => !linkedRewards.has(b.id));

    const options: Record<string, string[]> = {};
    for (const column of [
      "Nhà máy PV",
      "Tình trạng",
      "Tháng nhận việc",
      "Tuyển dụng",
      "Giới tính",
      "Loại HĐ",
      "Tình trạng đào tạo",
    ])
      options[column] = [
        ...new Set(
          rows.map((r) => String(r.sourceValues[column] ?? "")).filter(Boolean),
        ),
      ].sort();

    let pendingDuplicateCount = 0;
    let systemWarningCount = 0;
    for (const s of sources) {
      for (const r of s.rows) {
        const rawW = r.warnings || [];
        const rawD = r.duplicates || [];
        if (!rawW.length && !rawD.length) continue;
        const rev = splitImportReview([...rawW, ...rawD]);
        if (rev.duplicates.length > 0) pendingDuplicateCount++;
        if (rev.warnings.length > 0) systemWarningCount++;
      }
    }

    return { rows, options, pendingDuplicateCount, systemWarningCount, unlinkedBonusRows, bonusSourceRows: bonusRows.length, sourceRowCount: mainSourceRows.length,
      warningRows: rows.filter(r => r.sourceWarnings.length).length, approvedRows: rows.filter(r => r.isApproved).length,
      returningRows: rows.filter(r => r.isReturning).length, duplicateRows: rows.filter(r => r.sourceDuplicates.length).length };
}

export async function GET(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const archived = request.nextUrl.searchParams.get("archived") === "true";
    const { rows, options, pendingDuplicateCount, systemWarningCount, unlinkedBonusRows, bonusSourceRows, sourceRowCount,
      warningRows, approvedRows, returningRows, duplicateRows } = await cachedRead("worker-source-rows:" + archived, await readDataVersion(), () => buildWorkerRows(archived));
    const p = request.nextUrl.searchParams;

    // --- TÁCH THAM SỐ CHỌN NHIỀU (MULTI-SELECT) DẠNG MẢNG ---
    const factories = p.get("factory")?.split(",").filter(Boolean) || [];
    const statuses = p.get("status")?.split(",").filter(Boolean) || [];
    const sourceMonths = p.get("sourceMonth")?.split(",").filter(Boolean) || [];
    const recruiters = p.get("recruiter")?.split(",").filter(Boolean) || [];
    const fromDate = p.get("fromDate"); // YYYY-MM-DD
    const toDate = p.get("toDate"); // YYYY-MM-DD

    // --- CẬP NHẬT LOGIC LỌC ĐA ĐIỀU KIỆN & KHOẢNG THỜI GIAN ---
    const filtered = rows.filter((r) => {
      const v = r.sourceValues;

      // 1. Lọc theo tháng PV (nếu có)
      if (
        p.get("month") &&
        dateKey(String(v["Ngày PV"] || ""))?.slice(0, 7) !== p.get("month")
      ) {
        return false;
      }

      // 2. Lọc chọn nhiều: Nhà máy phỏng vấn
      if (
        factories.length > 0 &&
        !factories.includes(String(v["Nhà máy PV"] || ""))
      ) {
        return false;
      }

      // 3. Lọc chọn nhiều: Tình trạng
      if (
        statuses.length > 0 &&
        !statuses.includes(String(v["Tình trạng"] || ""))
      ) {
        return false;
      }

      // 4. Lọc chọn nhiều: Tháng nhận việc
      if (
        sourceMonths.length > 0 &&
        !sourceMonths.includes(String(v["Tháng nhận việc"] || ""))
      ) {
        return false;
      }

      // 5. Lọc chọn nhiều: Tuyển dụng
      if (
        recruiters.length > 0 &&
        !recruiters.includes(String(v["Tuyển dụng"] || ""))
      ) {
        return false;
      }

      // 6. Lọc khoảng thời gian (Từ ngày - Đến ngày dựa trên Ngày PV)
      const pvDateStr =
        dateKey(String(v["Ngày PV"] || "")) || String(v["Ngày PV"] || "");
      if (fromDate && pvDateStr && pvDateStr < fromDate) {
        return false;
      }
      if (toDate && pvDateStr && pvDateStr > toDate) {
        return false;
      }

      // 7. Lọc dòng cảnh báo
      if (p.get("warningsOnly") === "true" && r.sourceWarnings.length === 0) {
        return false;
      }

      // 7b. Lọc dòng đã duyệt
      if (p.get("approvedOnly") === "true" && !r.isApproved) {
        return false;
      }

      // 7c. Lọc lao động tái ký / quay lại
      if (
        (p.get("returningOnly") === "true" ||
          p.get("returning") === "true" ||
          p.get("isReturning") === "true") &&
        !r.isReturning
      ) {
        return false;
      }

      // 8. Tìm kiếm từ khóa
      if (p.get("search")) {
        const keyword = p.get("search")!.toLocaleLowerCase("vi");
        const matchSearch = Object.values(v).some((x) =>
          String(x ?? "")
            .toLocaleLowerCase("vi")
            .includes(keyword),
        );
        if (!matchSearch) return false;
      }

      // 9. Lọc theo cột tùy chọn
      if (p.get("columnValue")) {
        const colValue = String(
          v[p.get("column") || ""] ?? "",
        ).toLocaleLowerCase("vi");
        const searchColValue = p.get("columnValue")!.toLocaleLowerCase("vi");
        if (!colValue.includes(searchColValue)) return false;
      }

      return true;
    });

    const rawPage = Number(p.get("page"));
    const rawPageSize = Number(p.get("pageSize"));
    const paginated = p.has("page") || p.has("pageSize");
    const pageSize =
      Number.isFinite(rawPageSize) && rawPageSize > 0
        ? Math.min(200, Math.floor(rawPageSize))
        : 20;
    const page =
      Number.isFinite(rawPage) && rawPage > 0
        ? Math.min(
            Math.floor(rawPage),
            Math.max(1, Math.ceil(filtered.length / pageSize)),
          )
        : 1;
    return NextResponse.json({
      success: true,
      data: paginated
        ? filtered.slice((page - 1) * pageSize, page * pageSize)
        : filtered,
      filteredTotal: filtered.length,
      page,
      pageSize,
      options,
      pendingDuplicateCount,
      systemWarningCount,
      ...(p.get("view") === "list" ? { unlinkedBonusRowCount: unlinkedBonusRows.length } : { unlinkedBonusRows }),
      bonusSourceRows,
      totalRows: rows.length,
      sourceRows: sourceRowCount,
      warningRows,
      approvedRows,
      returningRows,
      duplicateRows,
    });
  } catch (error) {
    console.error(
      "worker-source-rows failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json(
      { success: false, message: "Không tải được dữ liệu nguồn" },
      { status: 500 },
    );
  }
}
