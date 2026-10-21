import { cachedRead } from "@/lib/read-cache";
import { readDataVersion } from "@/lib/read-data-version";
import { editableReviewFields, editReviewToken } from "@/lib/duplicate-edit-review";
import { compareDuplicateSides, comparisonState, displayReviewMonth } from "@/lib/duplicate-comparison";
import { reviewFields, reviewToken, resolveReview } from "@/lib/duplicate-resolution";
import { sourceConflicts, assertSourceCompatible, fillMissing, assertSourceCard, assertReviewProfile, assertIdentity, assertDailyInterview, sameInterviewDay, sameFactory, resolveBonusAssignment, isActiveAssignment } from "@/lib/duplicate-check";
import { guard, identity } from "@/lib/local-request";
import { NextRequest, NextResponse } from "next/server";
import {
  normalizeCccd,
  phoneKey,
  dateKey,
  formatExcelDate,
} from "@/lib/worker-validation";
import { prisma } from "@/lib/prisma";
import { matchFactory } from "@/lib/factory-matching";
import { today } from "@/lib/domain";
import {
  readImportSources,
  resolveImportSourceRow,
  correctImportSourceDate,
} from "@/lib/import-source-store";
import { splitImportReview } from "@/lib/import-review";
import { parseBonusImportRow, readBonusValue } from "@/lib/bonus-import";
import { parseImportRow, inferProvince } from "@/lib/worker-import";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

const resolvedFile = path.resolve(".local/resolved-duplicates.json");

async function readResolvedIds(): Promise<Set<string>> {
  try {
    const raw = await readFile(resolvedFile, "utf8");
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

async function addResolvedId(id: string) {
  const set = await readResolvedIds();
  set.add(id);
  await mkdir(path.dirname(resolvedFile), { recursive: true });
  await writeFile(resolvedFile, JSON.stringify([...set], null, 2), "utf8");
}

async function buildDuplicateSnapshot() {
    const [workers, resolvedIds, sources, statuses] = await Promise.all([
      prisma.worker.findMany({
        include: {
          assignments: {
            orderBy: { createdAt: "desc" },
          },
          bonusRecords: {
            orderBy: { createdAt: "desc" },
          },
          bankAccounts: {
            orderBy: { createdAt: "desc" },
          },
        },
      }),
      readResolvedIds(),
      readImportSources(),
      prisma.laborStatus.findMany({ where: { isActive: true } }),
    ]);

    const workerByCard = new Map<string, any>();
    const workerByPhone = new Map<string, any>();
    for (const w of workers) {
      if (w.idCard) workerByCard.set(normalizeCccd(w.idCard), w);
      if (w.phone) {
        const pk = phoneKey(w.phone);
        if (pk && !workerByPhone.has(pk)) workerByPhone.set(pk, w);
      }
    }

    // =========================================================================
    // DANH SÁCH CẢNH BÁO: MERGE_INFO VÀ CROSS_COMPANY
    // =========================================================================
    const mergeInfoAlerts: any[] = [];
    const crossCompanyAlerts: any[] = [];
    let unchangedCount = 0;
    const contexts = new Map<string, { worker: any; assignment: any; raw: any; type: string; editable: boolean }>();

    for (const source of sources) {
      for (const row of source.rows || []) {
        const review = splitImportReview([
          ...(row.warnings || []),
          ...(row.duplicates || []),
        ]);
        if (!review.duplicates.length) continue;

        const alertId = `import-${source.id}-${row.row}`;
        if (resolvedIds.has(alertId)) continue;

        const v = row.values || {};
        const rawCard =
          v["Số CCCD"] || v["số CCCD"] || v["CCCD"] || v["CMT/CCCD"] || "";
        const normCard = normalizeCccd(rawCard);
        const rawName = String(
          v["Họ tên"] || v["Họ và tên"] || v["Tên chủ tài khoản"] || "",
        ).trim();
        const rawPhone = String(v["SĐT"] || v["Số điện thoại"] || "").trim();
        const rawCompany = String(
          v["Công ty"] || v["Nhà máy PV"] || "",
        ).trim();
        const rawPv = formatExcelDate(
          v["Ngày PV"] || v["Ngày phỏng vấn"] || "",
        );
        const rawStatus = String(v["Tình trạng"] || "").trim();
        const rawCode = String(v["Mã NV"] || v["Mã nhân viên"] || "").trim();
        const rawGender = String(v["Giới tính"] || "").trim();
        const rawDob = formatExcelDate(v["Ngày sinh"] || "");
        const rawAddress = String(v["Địa chỉ"] || v["Quê quán"] || "").trim();
        const rawProvince = String(v["Tỉnh/Thành"] || v["Tỉnh"] || inferProvince(rawAddress)).trim();
        const rawRecruiter = String(
          v["Tuyển dụng"] || v["Người tuyển"] || "",
        ).trim();
        const rawMonth = String(v["Tháng"] || v["Tháng nhận việc"] || "").trim();
        const rawTotalBonus = String(v["Tổng thưởng"] || "").trim();
        const rawBonusDetails =
          [1, 2, 3, 4, 5, 6, 7]
            .map((n) =>
              v[`Thưởng lần ${n}`] ? `L${n}: ${v[`Thưởng lần ${n}`]}` : null,
            )
            .filter(Boolean)
            .join(" | ") || "";
        const rawBank =
          v["Ngân hàng"] || v["STK"]
            ? `${v["Ngân hàng"] || ""} - ${v["STK"] || ""}`.replace(
                /^ - | - $/g,
                "",
              )
            : "";

        const matchedWorker =
          (normCard ? workerByCard.get(normCard) : null) ||
          null;

        const dayAssignments = (matchedWorker?.assignments || []).filter((a: any) => sameInterviewDay(a, { interviewDate: rawPv }));
        const matchedAssignment = dayAssignments[0] || null;
        const conflicts = sourceConflicts(matchedWorker, v);
        let isConflict = conflicts.length > 0 || review.duplicates.some((d: any) => d.kind === "IDENTITY_MISMATCH");

        const isCrossCompany = review.duplicates.some(
          (d) => d.kind === "CROSS_COMPANY" || /CHƯA BÁO NGHỈ/i.test(d.message),
        );

        if (isCrossCompany && !isConflict) {
          const activeAssignment =
            (matchedWorker?.assignments || []).find((a: any) => isActiveAssignment(a, statuses)) ||
            matchedAssignment;
          const actFactory =
            activeAssignment?.interviewFactory ||
            "Chưa rõ công ty";

          crossCompanyAlerts.push({
            id: alertId,
            category: "CROSS_COMPANY",
            type: "ĐANG LÀM CÔNG TY NÀY NHƯNG PV / ĐI LÀM CÔNG TY KHÁC",
            severity: "CRITICAL",
            sourceId: source.id,
            row: row.row,
            fileName: source.file,
            workerId: matchedWorker?.id || null,
            currentAssignmentId: activeAssignment?.id || null,
            targetAssignmentId: activeAssignment?.id || null,
            reviewToken: reviewToken(matchedWorker, activeAssignment, v),
            newAssignmentId: null, // Đang được chặn an toàn ở file import, chưa ghi vào DB
            phone: rawPhone || matchedWorker?.phone || "",
            idCard: normCard || matchedWorker?.idCard || "—",
            fullName: rawName || matchedWorker?.fullName || "—",
            currentFactory: actFactory,
            currentStatus: activeAssignment?.status || "Đang làm việc",
            currentInterviewDate: activeAssignment?.interviewDate || "—",
            newFactory: rawCompany || "—",
            newStatus: rawStatus || "Mới nạp từ file (Chờ duyệt)",
            newInterviewDate: rawPv || "—",
            recruiter:
              activeAssignment?.recruiter || matchedWorker?.recruiter || "—",
            newRecruiter: rawRecruiter || "—",
            warning: `Đang làm việc tại "${actFactory}" (CHƯA BÁO NGHỈ) nhưng file "${source.file}" (Dòng #${row.row}) đăng ký vào "${rawCompany}".`,
            actionRequired: `Bấm 'Kiểm tra' để đối chiếu, bấm 'Duyệt' để chốt Đã nghỉ việc tại "${actFactory}" và kích hoạt đợt làm việc tại "${rawCompany}", hoặc 'Xóa' để hủy đợt này.`,
            leftSide: {
              title: "Công ty đang làm việc trong CSDL (Chưa báo nghỉ)",
              fullName: matchedWorker?.fullName || rawName || "—",
              idCard: matchedWorker?.idCard || normCard || "—",
              phone: matchedWorker?.phone || rawPhone || "—",
              gender: matchedWorker?.gender || "—",
              dob: matchedWorker?.dob || "—",
              province: matchedWorker?.province || inferProvince(matchedWorker?.address || "") || "—",
            address: matchedWorker?.address || "—",
              factory: actFactory,
              interviewDate: activeAssignment?.interviewDate || "—",
              startDate: activeAssignment?.startDate || "—",
              leaveDate: activeAssignment?.leaveDate || "Chưa có ngày nghỉ",
              status: activeAssignment?.status || "Đang làm việc",
              employeeCode:
                activeAssignment?.employeeCode || matchedWorker?.code || "—",
              recruiter:
                activeAssignment?.recruiter || matchedWorker?.recruiter || "—",
            },
            rightSide: {
              title: `Dòng mới từ file "${source.file}" (Dòng #${row.row})`,
              fullName: rawName || matchedWorker?.fullName || "—",
              idCard: normCard || matchedWorker?.idCard || "—",
              phone: rawPhone || matchedWorker?.phone || "—",
              gender: rawGender || "—",
              dob: rawDob || "—",
              province: rawProvince || "—",
            address: rawAddress || "—",
              factory: rawCompany || "—",
              interviewDate: rawPv || "—",
              startDate:
                formatExcelDate(
                  v["Ngày đi làm"] || v["Ngày bắt đầu làm"] || "",
                ) || "—",
              leaveDate: "—",
              status: rawStatus || "Chờ tiếp nhận",
              employeeCode: rawCode || "—",
              recruiter: rawRecruiter || "—",
            },
          });
          continue;
        }

        let parsedBonus: ReturnType<typeof parseBonusImportRow> | null = null;
        if (source.type === "DS_THUONG") {
          try { parsedBonus = parseBonusImportRow(v); } catch { /* Keep unreadable rows visible. */ }
        }
        // Never compare rewards belonging to a different interview or period.
        const matchedBonus = matchedWorker && parsedBonus && matchedAssignment
          ? (matchedWorker.bonusRecords || []).find((b: any) =>
              b.assignmentId === matchedAssignment.id && b.month === parsedBonus!.month &&
              sameFactory(b.company || "", parsedBonus!.company)) || null
          : null;
        let storedRewards: unknown[] = [];
        try {
          const rewards = JSON.parse(matchedBonus?.note || "{}").rewards;
          if (Array.isArray(rewards)) storedRewards = rewards;
        } catch { /* Legacy notes may not contain source rewards. */ }
        const dbBonusDetails = matchedBonus
          ? [1, 2, 3, 4, 5, 6, 7]
              .map((n) => {
                const val = matchedBonus[`bonus${n}`] || storedRewards[n - 1];
                return val
                  ? `L${n}: ${typeof val === "number" ? val.toLocaleString("vi-VN") + " đ" : String(val)}`
                  : null;
              })
              .filter(Boolean)
              .join(" | ")
          : "";

        const dbBank =
          matchedWorker?.bankAccounts?.[0]?.accountNumber ||
          matchedWorker?.bankAccounts?.[0]?.bankName
            ? `${matchedWorker?.bankAccounts?.[0]?.bankName || ""} - ${matchedWorker?.bankAccounts?.[0]?.accountNumber || ""}`.replace(
                /^ - | - $/g,
                "",
              )
            : "—";

        const issueMsg = review.duplicates
          .map((d) => d.message.replace(/^Dòng \d+:\s*/, ""))
          .join("; ");

        const alert: any = {
          id: alertId,
          category: isConflict ? "INTERVIEW_CONFLICT" : "MERGE_INFO",
          type: isConflict ? "XUNG ĐỘT LƯỢT TUYỂN — CẦN XÁC MINH" : "BỔ SUNG THÔNG TIN CÒN TRỐNG",
          severity: isConflict ? "CRITICAL" : "WARNING",
          canApprove: true,
          requiresDecision: isConflict,
          targetAssignmentId: matchedAssignment?.id || null,

          conflicts,
          sourceId: source.id,
          row: row.row,
          fileName: source.file,
          importType: source.type,
          workerId: matchedWorker?.id || null,
          phone: rawPhone || matchedWorker?.phone || "",
          idCard: normCard || matchedWorker?.idCard || "—",
          fullName: rawName || matchedWorker?.fullName || "—",
          currentFactory:
            matchedAssignment?.interviewFactory ||
            matchedBonus?.company ||
            rawCompany ||
            "—",
          currentStatus:
            matchedAssignment?.status ||
            (matchedBonus
              ? `Đã có thưởng (${Number(matchedBonus.totalBonus || 0).toLocaleString("vi-VN")} đ)`
              : "Đã có hồ sơ"),
          currentInterviewDate:
            matchedAssignment?.interviewDate ||
            matchedBonus?.interviewDate ||
            "—",
          newFactory: `${rawCompany || "—"} (File: ${source.file} - Dòng #${row.row})`,
          newStatus:
            rawStatus ||
            (rawTotalBonus
              ? `Tổng thưởng: ${rawTotalBonus}`
              : "Cập nhật từ file mới"),
          newInterviewDate: rawPv || "—",
          recruiter:
            matchedAssignment?.recruiter || matchedWorker?.recruiter || "—",
          newRecruiter: rawRecruiter || "—",
          warning: `Trùng hồ sơ khi nạp file "${source.file}" (Dòng #${row.row}): ${issueMsg}`,
          actionRequired:
            isConflict ? "Duyệt để áp dụng dữ liệu mới và lưu lịch sử trước/sau cùng người duyệt. Xóa chỉ bỏ dòng nhập mới, giữ hồ sơ đang có." : "Chỉ bổ sung các ô trống; giữ nguyên thông tin đã có.",
          leftSide: {
            title: "Hồ sơ đang có trong hệ thống",
            fullName: matchedWorker?.fullName || "—",
            idCard: matchedWorker?.idCard || "—",
            phone: matchedWorker?.phone || "—",
            gender: matchedWorker?.gender || "—",
            dob: matchedWorker?.dob || "—",
            province: matchedWorker?.province || inferProvince(matchedWorker?.address || "") || "—",
            address: matchedWorker?.address || "—",
            employeeCode:
              matchedAssignment?.employeeCode ||
              matchedBonus?.workerCode ||
              matchedWorker?.code ||
              "—",
            factory:
              matchedAssignment?.interviewFactory ||
              matchedBonus?.company ||
              "—",
            interviewDate:
              matchedAssignment?.interviewDate ||
              matchedBonus?.interviewDate ||
              "—",
            status: matchedAssignment?.status || "—",
            leaveDate: matchedAssignment?.leaveDate || "—",
            recruiter:
              matchedAssignment?.recruiter || matchedWorker?.recruiter || "—",
            month: matchedBonus?.month || "—",
            totalBonus: matchedBonus?.totalBonus
              ? `${Number(matchedBonus.totalBonus).toLocaleString("vi-VN")} đ`
              : "—",
            bonusDetails: dbBonusDetails || "—",
            bankInfo: dbBank,
          },
          rightSide: {
            title: `Dữ liệu mới từ File (${source.file} - Dòng #${row.row})`,
            fullName: rawName || "—",
            idCard: normCard || "—",
            phone: rawPhone || "—",
            gender: rawGender || "—",
            dob: rawDob || "—",
            province: rawProvince || "—",
            address: rawAddress || "—",
            employeeCode: rawCode || "—",
            factory: rawCompany || "—",
            interviewDate: rawPv || "—",
            status: rawStatus || "—",
            leaveDate: formatExcelDate(v["Ngày NH"] || v["Ngày nghỉ"] || "") || "—",
            recruiter: rawRecruiter || "—",
            month: source.type === "DS_THUONG" ? rawMonth || "—" : "—",
            totalBonus: rawTotalBonus || "—",
            bonusDetails: rawBonusDetails || "—",
            bankInfo: rawBank || "—",
          },
        };
        const extraRows: Array<{label: string; leftVal: any; rightVal: any}> = [];
        if (source.type === "DS_TONG") {
          try {
            const parsed = parseImportRow(v, true);
            // Mã NV is already compared against the matched interview, not a historical worker-level code.
            const extraWorker = { idCardDate: "Ngày cấp", idCardPlace: "Nơi cấp", source: "Nguồn" };
            const extraAssignment = {
              contractType: "Loại hợp đồng", leaveReason: "Lý do nghỉ", shuttleBusKtx: "Đón xe / KTX",
              startDate: "Ngày bắt đầu làm", passedDate: "Ngày đỗ", interviewResult: "Kết quả phỏng vấn",
              team: "Đội nhóm", expectedTrainingDate: "Ngày đào tạo dự kiến", expectedTrainingStatus: "Tình trạng đào tạo",
              standardTrainingDate: "Ngày đào tạo chuẩn", onboardingMonth: "Tháng nhận việc", orderId: "Đơn hàng", batchId: "Đợt tuyển",
            };
            for (const [labels, current, incoming] of [[extraWorker, matchedWorker, parsed.worker], [extraAssignment, matchedAssignment, parsed.assignment]] as const) {
              for (const [key, label] of Object.entries(labels)) {
                const value = (incoming as any)[key];
                if (value !== undefined && String(value).trim() !== "")
                  extraRows.push({ label, leftVal: current?.[key] || "—", rightVal: value });
              }
            }
          } catch {
            // Never hide a row whose full import payload could not be checked.
            conflicts.push("Dữ liệu nguồn cần kiểm tra trước khi xử lý");
          }
        } else if (source.type === "DS_THUONG") {
          if (!parsedBonus) conflicts.push("Dữ liệu thưởng cần kiểm tra trước khi xử lý");
          if (parsedBonus?.policy) extraRows.push({ label: "Chính sách thưởng", leftVal: matchedBonus?.policy || "—", rightVal: parsedBonus.policy });
        }
        const comparison = compareDuplicateSides(alert.leftSide, alert.rightSide, extraRows);
        const allConflicts = [...new Set([...conflicts, ...comparison.conflicts])];
        isConflict = isConflict || allConflicts.length > 0;
        // Missing profiles, interviews or reward records must remain reviewable.
        const hasTarget = !!matchedWorker && !!matchedAssignment &&
          (source.type !== "DS_THUONG" || !!matchedBonus);
        if (!isConflict && !comparison.additions.length && hasTarget) {
          unchangedCount++;
          continue;
        }
        alert.category = isConflict ? "INTERVIEW_CONFLICT" : "MERGE_INFO";
        alert.type = isConflict ? "THÔNG TIN KHÁC NHAU — CẦN XÁC MINH" : "BỔ SUNG THÔNG TIN CÒN TRỐNG";
        alert.severity = isConflict ? "CRITICAL" : "WARNING";
        alert.requiresDecision = isConflict;
        alert.conflicts = allConflicts;
        alert.extraRows = extraRows;
        // Existing approval supports leaveReason and reward policy, but not these extra profile fields.
        // Keep them reviewable without silently discarding a change that approval cannot apply.
        const unsupportedChanges = extraRows.filter(r =>
          !["Lý do nghỉ", "Chính sách thưởng"].includes(r.label) &&
          Object.values(comparisonState(r.label, r.leftVal, r.rightVal, alert.leftSide, alert.rightSide)).some(Boolean));
        if (unsupportedChanges.length) {
          alert.canApprove = false;
          alert.blockedApprovalReason = "Cần đối chiếu và chỉnh tại hồ sơ trước khi duyệt: " + unsupportedChanges.map(r => r.label).join(", ");
        }
        alert.leftSide.month = displayReviewMonth(alert.leftSide.month, alert.leftSide.interviewDate);
        alert.rightSide.month = displayReviewMonth(alert.rightSide.month, alert.rightSide.interviewDate);
        alert.actionRequired = isConflict
          ? "Kiểm tra thông tin khác nhau trước khi duyệt dữ liệu mới; lịch sử trước/sau được lưu lại."
          : "Có thông tin bổ sung; kiểm tra trước khi duyệt.";
        contexts.set(alert.id, { worker: matchedWorker, assignment: matchedAssignment, raw: v, type: source.type,
          editable: !!matchedWorker && !!matchedAssignment && dayAssignments.length === 1 });
        mergeInfoAlerts.push(alert);
      }
    }

    // =========================================================================
    // TRƯỜNG HỢP 2: ĐANG LÀM CÔNG TY NÀY NHƯNG PV / ĐI LÀM Ở CÔNG TY KHÁC (QUÉT THÊM TRONG CSDL)
    // =========================================================================
    const phoneMap = new Map<string, typeof workers>();

    for (const w of workers) {
      if (w.assignments.length > 1) {
        const activeList = w.assignments.filter((a: any) => isActiveAssignment(a, statuses));
        if (activeList.length > 1) {
          // Chỉ cảnh báo nếu có từ 2 đợt CÙNG ĐANG ACTIVE ở 2 công ty khác nhau trong CSDL
          const seenPairs = new Set<string>();
          for (let i = 0; i < activeList.length; i++) {
            for (let j = i + 1; j < activeList.length; j++) {
              const act = activeList[j];
              const other = activeList[i];
              const actFactory =
                act.interviewFactory || "Chưa rõ công ty";
              const otherFactory =
                other.interviewFactory ||
                "Chưa rõ công ty";

              if (!matchFactory(actFactory, otherFactory)) {
                const pairKey = [act.id, other.id].sort().join("-");
                if (seenPairs.has(pairKey)) continue;
                seenPairs.add(pairKey);

                const alertId = `${w.id}-${act.id}-${other.id}`;
                if (resolvedIds.has(alertId)) continue;

                crossCompanyAlerts.push({
                  id: alertId,
                  category: "CROSS_COMPANY",
                  type: "ĐANG LÀM CÔNG TY NÀY NHƯNG PV / ĐI LÀM CÔNG TY KHÁC",
                  severity: "CRITICAL",
                  workerId: w.id,
                  currentAssignmentId: act.id,
                  newAssignmentId: other.id,
                  phone: w.phone,
                  idCard: w.idCard,
                  fullName: w.fullName,
                  currentFactory: actFactory,
                  currentStatus: act.status || "Đang làm việc",
                  currentInterviewDate: act.interviewDate || "—",
                  newFactory: otherFactory,
                  newStatus: other.status || "Mới phát sinh",
                  newInterviewDate: other.interviewDate || "—",
                  recruiter: act.recruiter || w.recruiter || "—",
                  newRecruiter: other.recruiter || "—",
                  warning: `Đang làm việc tại "${actFactory}" (chưa báo nghỉ) nhưng lại có hợp đồng song song tại "${otherFactory}".`,
                  actionRequired: `Bấm 'Duyệt' để chốt Đã nghỉ việc ở "${actFactory}" và giữ đợt ở "${otherFactory}", hoặc bấm 'Xóa' để hủy đợt trùng.`,
                  leftSide: {
                    title: "Công ty đang làm việc (Chưa báo nghỉ)",
                    fullName: w.fullName,
                    idCard: w.idCard,
                    phone: w.phone || "—",
                    gender: w.gender || "—",
                    dob: w.dob || "—",
                    province: w.province || inferProvince(w.address || "") || "—",
                    address: w.address || "—",
                    factory: actFactory,
                    interviewDate: act.interviewDate || "—",
                    startDate: act.startDate || "—",
                    leaveDate: act.leaveDate || "Chưa có ngày nghỉ",
                    status: act.status || "Đang làm việc",
                    employeeCode: act.employeeCode || w.code || "—",
                    recruiter: act.recruiter || w.recruiter || "—",
                  },
                  rightSide: {
                    title: "Công ty mới phỏng vấn / đi làm",
                    fullName: w.fullName,
                    idCard: w.idCard,
                    phone: w.phone || "—",
                    gender: w.gender || "—",
                    dob: w.dob || "—",
                    province: w.province || inferProvince(w.address || "") || "—",
                    address: w.address || "—",
                    factory: otherFactory,
                    interviewDate: other.interviewDate || "—",
                    startDate: other.startDate || "—",
                    leaveDate: other.leaveDate || "—",
                    status: other.status || "Mới phát sinh",
                    employeeCode: other.employeeCode || w.code || "—",
                    recruiter: other.recruiter || w.recruiter || "—",
                  },
                });
              }
            }
          }
        }
      }

      if (w.phone) {
        const key = phoneKey(w.phone);
        if (key) {
          const list = phoneMap.get(key) || [];
          list.push(w);
          phoneMap.set(key, list);
        }
      }
    }

    // Quét thêm trường hợp 2 công nhân khác nhau trùng SĐT và CÙNG ĐANG ACTIVE ở 2 công ty khác nhau
    phoneMap.forEach((list, phone) => {
      if (list.length > 1) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const w1 = list[i];
            const w2 = list[j];
            const act1 = (w1.assignments || []).find((a: any) => isActiveAssignment(a, statuses));
            const act2 = (w2.assignments || []).find((a: any) => isActiveAssignment(a, statuses));
            if (act1 && act2) {
              const f1 = act1.interviewFactory || "Chưa rõ";
              const f2 = act2.interviewFactory || "Chưa rõ";
              if (!matchFactory(f1, f2)) {
                const alertId = `phone-active-${phone}-${w1.id}-${w2.id}`;
                if (resolvedIds.has(alertId)) continue;

                crossCompanyAlerts.push({
                  id: alertId,
                  category: "CROSS_COMPANY",
                  type: "ĐANG LÀM CÔNG TY NÀY NHƯNG PV / ĐI LÀM CÔNG TY KHÁC",
                  severity: "CRITICAL",
                  workerId: w2.id,
                  otherWorkerId: w1.id,
                  currentAssignmentId: act1.id,
                  newAssignmentId: act2.id,
                  phone,
                  idCard: w2.idCard,
                  fullName: w2.fullName,
                  currentFactory: f1,
                  currentStatus: `${w1.fullName} (${act1.status || "Đang làm việc"})`,
                  currentInterviewDate: act1.interviewDate || "—",
                  newFactory: f2,
                  newStatus: `${w2.fullName} (${act2.status || "Đang làm việc"})`,
                  newInterviewDate: act2.interviewDate || "—",
                  recruiter: act2.recruiter || w2.recruiter || "—",
                  warning: `SĐT ${phone} đang đi làm tại "${f1}" (${w1.fullName}) nhưng lại đăng ký tại "${f2}" (${w2.fullName}).`,
                  actionRequired: `Bấm 'Kiểm tra' để đối chiếu 2 công ty, bấm 'Duyệt' nếu xác nhận chuyển đổi hoặc 'Xóa' để hủy bản ghi trùng.`,
                  leftSide: {
                    title: `Công ty tại "${f1}" (${w1.fullName})`,
                    fullName: w1.fullName,
                    idCard: w1.idCard,
                    phone: w1.phone || phone,
                    gender: w1.gender || "—",
                    dob: w1.dob || "—",
                    province: w1.province || inferProvince(w1.address || "") || "—",
                    address: w1.address || "—",
                    factory: f1,
                    interviewDate: act1.interviewDate || "—",
                    startDate: act1.startDate || "—",
                    leaveDate: act1.leaveDate || "Chưa có ngày nghỉ",
                    status: act1.status || "Đang làm việc",
                    employeeCode: act1.employeeCode || w1.code || "—",
                    recruiter: act1.recruiter || w1.recruiter || "—",
                  },
                  rightSide: {
                    title: `Công ty tại "${f2}" (${w2.fullName})`,
                    fullName: w2.fullName,
                    idCard: w2.idCard,
                    phone: w2.phone || phone,
                    gender: w2.gender || "—",
                    dob: w2.dob || "—",
                    province: w2.province || inferProvince(w2.address || "") || "—",
                    address: w2.address || "—",
                    factory: f2,
                    interviewDate: act2.interviewDate || "—",
                    startDate: act2.startDate || "—",
                    leaveDate: act2.leaveDate || "Chưa có ngày nghỉ",
                    status: act2.status || "Đang làm việc",
                    employeeCode: act2.employeeCode || w2.code || "—",
                    recruiter: act2.recruiter || w2.recruiter || "—",
                  },
                });
              }
            }
          }
        }
      }
    });

    const allAlerts = [...mergeInfoAlerts, ...crossCompanyAlerts];

    return { allAlerts, contexts, counts: {
      mergeInfoCount: mergeInfoAlerts.filter(a => a.category === "MERGE_INFO").length,
      conflictCount: mergeInfoAlerts.filter(a => a.category === "INTERVIEW_CONFLICT").length,
      crossCompanyCount: crossCompanyAlerts.length, unchangedCount,
    } };
}

function duplicateDetail(snapshot: Awaited<ReturnType<typeof buildDuplicateSnapshot>>, alert: any) {
  const context = snapshot.contexts.get(alert.id);
  if (!context) return alert;
  const { worker, assignment, raw, type, editable } = context;
  return { ...alert, reviewToken: reviewToken(worker, assignment, raw), ...(editable ? {
    editableFields: editableReviewFields(worker, assignment, raw, type),
    editReviewToken: editReviewToken(worker, assignment, raw, type),
  } : {}) };
}
export async function GET(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const p = request.nextUrl?.searchParams;
    // Legacy export callers retain full data. Interactive lists share the derived snapshot.
    const snapshot = p?.has("view") || p?.has("id")
      ? await cachedRead("duplicate-snapshot", await readDataVersion(), buildDuplicateSnapshot)
      : await buildDuplicateSnapshot();
    const { allAlerts, counts } = snapshot;
    if (p?.has("id")) {
      const alert = allAlerts.find(a => a.id === p.get("id"));
      return alert ? NextResponse.json({ success: true, data: duplicateDetail(snapshot, alert) })
        : NextResponse.json({ success: false, message: "Dòng đã thay đổi hoặc đã xử lý; tải lại danh sách" }, { status: 404 });
    }
    if (p?.get("view") === "list") {
      const keyword = (p.get("search") || "").trim().toLocaleLowerCase("vi");
      const category = p.get("category") || "ALL";
      const filtered = allAlerts.filter(a => (category === "ALL" || a.category === category) &&
        (!keyword || [a.fullName, a.idCard, a.phone, a.currentFactory, a.newFactory, a.recruiter, a.warning].join(" ").toLocaleLowerCase("vi").includes(keyword)));
      const pageSize = Math.min(100, Math.max(1, Math.floor(Number(p.get("pageSize")) || 20)));
      const page = Math.min(Math.max(1, Math.floor(Number(p.get("page")) || 1)), Math.max(1, Math.ceil(filtered.length / pageSize)));
      const data = filtered.slice((page - 1) * pageSize, page * pageSize).map(({leftSide, rightSide, reviewToken, editableFields, editReviewToken, extraRows, ...summary}: any) => summary);
      return NextResponse.json({ success: true, data, totalDuplicates: allAlerts.length, filteredTotal: filtered.length, page, pageSize, counts });
    }
    return NextResponse.json({ success: true, data: allAlerts.map(a => duplicateDetail(snapshot, a)), totalDuplicates: allAlerts.length, counts });
  } catch {
    return NextResponse.json({ success: false, message: "Không thể tải cảnh báo trùng" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  const actor = (await identity(request))!;

  try {
    const body = await request.json();
    const {
      action,
      id,
      category,
      type,
      sourceId,
      row,
      workerId,
      currentAssignmentId,
      newAssignmentId,
      newInterviewDate,
      idCard,
      fullName,
    } = body || {};

    if (!id || !["APPROVE", "DELETE"].includes(action)) {
      return NextResponse.json(
        { success: false, message: "Thiếu thông tin cảnh báo hoặc thao tác" },
        { status: 400 },
      );
    }

    if (body.resolution && sourceId && row != null) {
      const source=(await readImportSources()).find((s:any)=>s.id===String(sourceId));
      const incoming=source?.rows?.find((r:any)=>Number(r.row)===Number(row));
      if(!incoming) return NextResponse.json({success:false,message:"Dòng nguồn đã thay đổi hoặc đã xử lý; tải lại danh sách"},{status:409});
      if(source.type==='DS_THUONG'){const denied=await guard(request);if(denied)return denied;}
      const decision=await prisma.$transaction(tx=>resolveReview(tx,source,incoming,body,actor.username));
      if(decision.removeSource) await resolveImportSourceRow(String(sourceId),Number(row),'DELETE');
      else if(decision.correctedInterviewDate) await correctImportSourceDate(String(sourceId),Number(row),decision.correctedInterviewDate);
      return NextResponse.json({success:true,message:decision.message,data:{sourceRemoved:decision.removeSource,...("previewFields" in decision ? {previewFields:decision.previewFields,changeCount:decision.changeCount} : {})}});
    }

    if (sourceId && row != null) {
      const stored = (await readImportSources()).find((s: any) => s.id === String(sourceId));
      const incoming = stored?.rows?.find((r: any) => Number(r.row) === Number(row));
      if (!incoming) return NextResponse.json({success:false,message:"Không tìm thấy dòng nguồn"},{status:404});
      const raw = incoming.values || {};
      const card = normalizeCccd(raw["Số CCCD"] || raw["số CCCD"] || raw.CCCD || "");
      const person = await prisma.worker.findUnique({where:{idCard:card},include:{assignments:true}});
      const conflicts = sourceConflicts(person, raw);
      if (conflicts.length) return NextResponse.json({success:false,code:"INTERVIEW_CONFLICT",message:"Xung đột lượt tuyển: " + conflicts.join("; ") + ". Không được bổ sung, ghi đè hoặc tạo lượt mới."},{status:409});
    }

    // =========================================================================
    // XỬ LÝ TRƯỜNG HỢP 1: BỔ SUNG / GHI ĐÈ THÔNG TIN HỒ SƠ TỪ FILE IMPORT
    // =========================================================================
    if (category === "MERGE_INFO" && sourceId && row != null) {
      if (action === "DELETE") {
        await resolveImportSourceRow(String(sourceId), Number(row), "DELETE");
        await addResolvedId(String(id));
        await prisma.auditLog.create({
          data: {
            module: "DUPLICATE",
            action: "DELETE",
            operator: actor.username,
            details: `Xóa dòng trùng #${row} (${fullName || ""} - ${idCard || ""}) khỏi danh sách bổ sung thông tin`,
          },
        });
        return NextResponse.json({
          success: true,
          message: `Đã xóa dòng trùng #${row} khỏi danh sách cảnh báo`,
        });
      }

      // action === "APPROVE" -> Ghi đè / bổ sung thông tin vào CSDL
      const sources = await readImportSources();
      const targetSource = sources.find((s: any) => s.id === String(sourceId));
      const targetRow = (targetSource?.rows || []).find(
        (r: any) => Number(r.row) === Number(row),
      );
      if (!targetSource || !targetRow) {
        await addResolvedId(String(id));
        return NextResponse.json({
          success: true,
          message: "Đã duyệt bản ghi",
        });
      }

      if (!(targetRow.warnings || []).length && !(targetRow.duplicates || []).length) throw new Error("Dòng đã xử lý; tải lại danh sách");
      const raw = targetRow.values || {};
      const importType = targetSource.type;
      if (importType === "DS_THUONG") { const denied = await guard(request); if (denied) return denied; }

      await prisma.$transaction(async (tx) => {
        if (importType === "DS_THUONG") {
          const parsed = parseBonusImportRow(raw);
          assertSourceCard(raw, parsed.idCard);
          const {
            sequence,
            idCard: parsedCard,
            fullName: parsedName,
            company,
            month,
            interviewDate,
            policy,
            workerCode,
            accountNumber,
            bankName,
            bonuses,
            totalBonus,
          } = parsed;
          const [bonus1, bonus2, bonus3, bonus4, bonus5, bonus6, bonus7] =
            bonuses;

          let worker = await tx.worker.findUnique({
            where: { idCard: parsedCard },
            include: { assignments: true },
          });
          if (!worker) {
            worker = await tx.worker.create({
              data: {
                idCard: parsedCard,
                fullName: parsedName || "Chưa rõ tên",
              },
              include: { assignments: true },
            });
          }
          assertIdentity(worker, parsedName);
          assertSourceCompatible(worker, raw);
          const matchedAssignment = resolveBonusAssignment(worker, parsed);
          if (!matchedAssignment) throw new Error("Chưa có lượt PV khớp; không liên kết sang đợt khác");

          const existingBonus = await tx.bonusRecord.findFirst({
            where: {
              workerId: worker.id,
              month,
              company,
              assignmentId: matchedAssignment.id,
            },
          });

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

          if (existingBonus) {
            if (existingBonus.status !== "DRAFT") throw new Error("Bản thưởng đã duyệt/khóa; không ghi đè");
            await tx.bonusRecord.update({
              where: { id: existingBonus.id },
              data: {
                assignmentId:
                  matchedAssignment?.id || existingBonus.assignmentId || null,
                company,
                month,
                interviewDate: interviewDate || existingBonus.interviewDate,
                policy: policy || existingBonus.policy,
                workerCode: workerCode || existingBonus.workerCode,
                bonus1: bonus1 || existingBonus.bonus1,
                bonus2: bonus2 || existingBonus.bonus2,
                bonus3: bonus3 || existingBonus.bonus3,
                bonus4: bonus4 || existingBonus.bonus4,
                bonus5: bonus5 || existingBonus.bonus5,
                bonus6: bonus6 || existingBonus.bonus6,
                bonus7: bonus7 || existingBonus.bonus7,
                totalBonus: totalBonus || existingBonus.totalBonus,
                note: sourceNote,
              },
            });
          } else {
            await tx.bonusRecord.create({
              data: {
                workerId: worker.id,
                assignmentId: matchedAssignment?.id || null,
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
              },
            });
          }

          if (accountNumber) {
            const existingBank = await tx.bankAccount.findFirst({
              where: {
                workerId: worker.id,
                accountNumber: String(accountNumber).trim(),
              },
            });
            if (existingBank) {
              if (bankName) {
                await tx.bankAccount.update({
                  where: { id: existingBank.id },
                  data: { bankName: String(bankName).trim() },
                });
              }
            } else {
              await tx.bankAccount.create({
                data: {
                  workerId: worker.id,
                  accountNumber: String(accountNumber).trim(),
                  bankName: String(bankName || "").trim() || "Chưa xác định",
                  accountHolderName: parsedName || worker.fullName,
                  isNameVerified: true,
                  verificationStatus: "VERIFIED",
                },
              });
            }
          }
        } else {
          const { worker, assignment } = parseImportRow(raw, true);
        assertSourceCard(raw, worker.idCard);
          let person = await tx.worker.findUnique({
            where: { idCard: worker.idCard },
            include: { assignments: true },
          });
          const cleanWorkerData = Object.fromEntries(
            Object.entries(worker).filter(
              ([_, val]) =>
                val !== undefined && val !== null && String(val).trim() !== "",
            ),
          );
          if (!person) {
            person = await tx.worker.create({
              data: {
                ...cleanWorkerData,
                idCard: worker.idCard,
                fullName: worker.fullName || "Chưa rõ tên",
              },
              include: { assignments: true },
            });
          } else {
            assertSourceCompatible(person, raw);
          assertIdentity(person, worker.fullName);
            await tx.worker.update({
              where: { id: person.id },
              data: fillMissing(person, cleanWorkerData),
            });
          }

          const matchedAssignment = (person.assignments || []).find(
            (a: any) =>
              sameFactory(a.interviewFactory, assignment.interviewFactory) && sameInterviewDay(a, assignment),
          );
          await assertReviewProfile(tx, person, worker, assignment, matchedAssignment?.id);
          const cleanAssignmentData = Object.fromEntries(
            Object.entries(assignment).filter(
              ([k, val]) =>
                !["orderId", "batchId"].includes(k) &&
                val !== undefined &&
                val !== null &&
                String(val).trim() !== "",
            ),
          );

          if (matchedAssignment) {
            await tx.workAssignment.update({
              where: { id: matchedAssignment.id },
              data: fillMissing(matchedAssignment, cleanAssignmentData),
            });
          } else if (assignment.interviewFactory) {
            const created = await tx.workAssignment.create({
              data: {
                ...cleanAssignmentData,
                interviewFactory: assignment.interviewFactory,
                workerId: person.id,
              } as any,
            });
            await tx.assignmentEvent.create({
              data: {
                assignmentId: created.id,
                occurredOn: today(),
                toStatus: created.status,
                interviewResult: created.interviewResult,
                operator: actor.username,
                note: `Import Excel (Đã duyệt bổ sung thông tin dòng #${row})`,
              },
            });
          }
        }

        await tx.auditLog.create({
          data: {
            module: "DUPLICATE",
            action: "APPROVE",
            operator: actor.username,
            details: `Duyệt bổ sung / ghi đè thông tin dòng #${row} (${importType}) cho ${fullName || ""} (${idCard || ""})`,
          },
        });
      });

      await resolveImportSourceRow(String(sourceId), Number(row), "APPROVE");
      await addResolvedId(String(id));
      return NextResponse.json({
        success: true,
        message:
          "Đã duyệt và ghi đè bổ sung thông tin đầy đủ vào hồ sơ thành công",
      });
    }

    // =========================================================================
    // XỬ LÝ TRƯỜNG HỢP 2: ĐANG LÀM CÔNG TY NÀY NHƯNG PV / ĐI LÀM CÔNG TY KHÁC
    // =========================================================================
    if (action === "DELETE") {
      if (sourceId && row != null) {
        // Đợt mới đang được chặn an toàn ở file import: chỉ cần xóa khỏi danh sách chờ duyệt,
        // TUYỆT ĐỐI không xóa đợt đang làm việc (currentAssignmentId) trong CSDL cũ!
        await resolveImportSourceRow(String(sourceId), Number(row), "DELETE");
      } else if (newAssignmentId) {
        // Trường hợp cả 2 đợt cùng có trong CSDL: chỉ xóa đợt mới (newAssignmentId), giữ nguyên đợt cũ!
        await prisma.$transaction(async (tx) => {
          const existingAssign = await tx.workAssignment.findUnique({
            where: { id: String(newAssignmentId) },
          });
          if (existingAssign) {
            await tx.workAssignment.delete({
              where: { id: existingAssign.id },
            });
          }
        });
      }

      await addResolvedId(String(id));
      await prisma.auditLog.create({
        data: {
          module: "DUPLICATE",
          action: "DELETE",
          operator: actor.username,
          details: `Hủy bỏ đợt tuyển trùng lặp [${type || id}] của ${fullName || ""} (${idCard || ""})`,
        },
      });

      return NextResponse.json({
        success: true,
        message: "Đã hủy bỏ đợt tuyển trùng lặp thành công",
      });
    }

    if (action === "APPROVE") {
      await prisma.$transaction(async (tx) => {
        // 1. Chốt trạng thái Đã nghỉ việc tại công ty cũ
        if (currentAssignmentId && !String(id).startsWith("phone-active-")) {
          const leaveDay =
            newInterviewDate && newInterviewDate !== "—"
              ? String(newInterviewDate)
              : today();
          const oldAssign = await tx.workAssignment.findUnique({
            where: { id: String(currentAssignmentId) },
          });
          if (oldAssign) {
            await tx.workAssignment.update({
              where: { id: oldAssign.id },
              data: {
                status: "Đã nghỉ việc",
                leaveDate: oldAssign.leaveDate || leaveDay,
                leaveReason:
                  oldAssign.leaveReason ||
                  "Chuyển công ty mới (Đã duyệt cảnh báo trùng nhảy xưởng)",
              },
            });
            await tx.assignmentEvent.create({
              data: {
                assignmentId: oldAssign.id,
                occurredOn: today(),
                fromStatus: oldAssign.status,
                toStatus: "Đã nghỉ việc",
                operator: actor.username,
                note: "Duyệt cảnh báo trùng: chốt nghỉ công ty cũ để tiếp nhận công ty mới",
              },
            });
          }
        }

        // 2. Kích hoạt tạo đợt làm việc tại công ty mới từ file nguồn (nếu bị chặn lúc import)
        if (sourceId && row != null) {
          const sources = await readImportSources();
          const targetSource = sources.find((s: any) => s.id === String(sourceId));
          const targetRow = (targetSource?.rows || []).find(
            (r: any) => Number(r.row) === Number(row),
          );
          if (!targetRow) throw new Error("Không tìm thấy dòng nguồn; tải lại danh sách");
          if (!(targetRow.warnings || []).length && !(targetRow.duplicates || []).length) throw new Error("Dòng đã xử lý; tải lại danh sách");
          if (targetRow) {
            const raw = targetRow.values || {};
            const { worker, assignment } = parseImportRow(raw, true);
            let person = await tx.worker.findUnique({
              where: { idCard: worker.idCard },
            });
            if (!person) {
              person = await tx.worker.create({
                data: {
                  idCard: worker.idCard,
                  fullName: worker.fullName || fullName || "Chưa rõ tên",
                  phone: worker.phone,
                  gender: worker.gender,
                  dob: worker.dob,
                  address: worker.address,
                  province: worker.province,
                },
              });
            }
            const existingPerson = await tx.worker.findUnique({ where: { id: person.id }, include: { assignments: true } });
            assertIdentity(existingPerson, worker.fullName);
            assertDailyInterview(existingPerson, assignment);
            const cleanAssignmentData = Object.fromEntries(
              Object.entries(assignment).filter(
                ([k, val]) =>
                  !["orderId", "batchId"].includes(k) &&
                  val !== undefined &&
                  val !== null &&
                  String(val).trim() !== "",
              ),
            );
            const createdAssign = await tx.workAssignment.create({
              data: {
                ...cleanAssignmentData,
                interviewFactory: assignment.interviewFactory,
                workerId: person.id,
              } as any,
            });
            await tx.assignmentEvent.create({
              data: {
                assignmentId: createdAssign.id,
                occurredOn: today(),
                toStatus: createdAssign.status,
                interviewResult: createdAssign.interviewResult || "UNKNOWN",
                operator: actor.username,
                note: `Duyệt cảnh báo trùng: tiếp nhận công ty mới từ file ${targetSource.file} dòng #${row}`,
              },
            });
          }
          await resolveImportSourceRow(String(sourceId), Number(row), "APPROVE");
        }

        await tx.auditLog.create({
          data: {
            module: "DUPLICATE",
            action: "APPROVE",
            operator: actor.username,
            details: `Duyệt tiếp nhận công ty mới và chốt nghỉ công ty cũ cho ${fullName || ""} (${idCard || ""})`,
          },
        });
      });

      await addResolvedId(String(id));
      return NextResponse.json({
        success: true,
        message:
          "Đã duyệt: tự động chốt nghỉ việc ở công ty cũ và kích hoạt đợt làm việc tại công ty mới thành công",
      });
    }
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        message: "Không thể xử lý cảnh báo: " + (err?.message || "Lỗi"),
      },
      { status: 400 },
    );
  }
}
