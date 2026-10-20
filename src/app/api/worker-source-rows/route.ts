import { splitImportReview } from "@/lib/import-review";
import { dateKey } from "@/lib/worker-validation";
import { matchFactory } from "@/lib/factory-matching";
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readImportSources } from "@/lib/import-source-store";
import {
  normalizeWorkerSourceValues,
  workerSourceView,
} from "@/lib/worker-source-view";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const [sources, workers] = await Promise.all([
      readImportSources(),
      prisma.worker.findMany({
        where: {
          archivedAt:
            request.nextUrl.searchParams.get("archived") === "true"
              ? { not: null }
              : null,
        },
        include: {
          assignments: {
            include: {
              events: { where: { note: { startsWith: "Import Excel — source:" } }, orderBy: { createdAt: "desc" }, take: 1, select: { note: true } },
            },
          },
          bankAccounts: true,
        },
      }),
    ]);

    const people = new Map(workers.map((w) => [w.idCard, w]));
    const assignmentValues = (a: any) => ({
      id: a.id,
      updatedAt: a.updatedAt,
      contractType: a.contractType,
      status: a.status,
      interviewFactory: a.interviewFactory,
      workingFactory: a.workingFactory,
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
        return {
          id: `source-${s.id}-${r.row}`,
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
        };
      }),
    );

    const pendingDuplicateRows = sourceRows.filter(
      (r) => r.sourceDuplicates.length > 0,
    );
    const mainSourceRows = sourceRows.filter((r) => !r.sourceDuplicates.length);

    // The recruitment identity is CCCD + interview day; company/code can change after review.
    const sourceKey = (card: string, v: any) => {
      const day = dateKey(String(v["Ngày PV"] || ""));
      return day && card ? [card.replace(/\s+/g, ""), day].join("|") :
        [card, String(v["Nhà máy PV"] || ""), String(v["Ngày PV"] || ""), String(v["Mã NV"] || "")].join("|");
    };
    const visibleRecruitments = new Set<string>();
    const currentSourceRows = mainSourceRows.map(r => {
      const worker = people.get(r.idCard);
      const day = dateKey(String(r.sourceValues["Ngày PV"] || ""));
      const assignment = day ? worker?.assignments.find(a => dateKey(a.interviewDate) === day) : null;
      if (!worker || !assignment) return r;
      return { ...r, sourceValues: workerSourceView(worker, assignment, true).values,
        assignments: [assignmentValues(assignment)] };
    }).filter(r => {
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

    const rows = [...currentSourceRows, ...canonical].map((r) => {
      const candidateBonuses = bonusRowsByCccd.get(r.idCard);
      const rewardSource = candidateBonuses
        ? candidateBonuses.filter(
            (b) =>
              matchFactory(
                String(b.values["Công ty"] || ""),
                String(r.sourceValues["Nhà máy PV"] || ""),
              ) ||
              matchFactory(
                String(b.values["Công ty"] || ""),
                String(r.sourceValues["Nhà máy làm việc"] || ""),
              ),
          )
        : [];
      return {
        ...r,
        rewardSource,
      };
    });

    const linkedRewards = new Set(
      rows.flatMap((r) => r.rewardSource.map((b) => b.id)),
    );
    const unlinkedBonusRows = bonusRows.filter((b) => !linkedRewards.has(b.id));

    const options: Record<string, string[]> = {};
    for (const column of [
      "Nhà máy PV",
      "Nhà máy làm việc",
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
      if (p.get("warningsOnly") && r.sourceWarnings.length === 0) {
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

    const rawPage = Number(p.get("page"));
    const rawPageSize = Number(p.get("pageSize"));
    const paginated = p.has("page") || p.has("pageSize");
    const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 ? Math.min(200, Math.floor(rawPageSize)) : 20;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(Math.floor(rawPage), Math.max(1, Math.ceil(filtered.length / pageSize))) : 1;
    return NextResponse.json({
      success: true,
      data: paginated ? filtered.slice((page - 1) * pageSize, page * pageSize) : filtered,
      filteredTotal: filtered.length,
      page,
      pageSize,
      options,
      pendingDuplicateCount,
      systemWarningCount,
      unlinkedBonusRows,
      bonusSourceRows: bonusRows.length,
      totalRows: rows.length,
      sourceRows: mainSourceRows.length,
      warningRows: rows.filter((r) => r.sourceWarnings.length).length,
      duplicateRows: rows.filter((r) => r.sourceDuplicates.length).length,
    });
  } catch (error) {
    console.error("worker-source-rows failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, message: "Không tải được dữ liệu nguồn" },
      { status: 500 },
    );
  }
}
