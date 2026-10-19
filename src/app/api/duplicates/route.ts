import { guard, identity } from "@/lib/auth";
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
} from "@/lib/import-source-store";
import { splitImportReview } from "@/lib/import-review";
import { parseBonusImportRow, readBonusValue } from "@/lib/bonus-import";
import { parseImportRow } from "@/lib/worker-import";
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

function isInactiveStatus(status?: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  return (
    s === "đã nghỉ việc" ||
    s === "nghỉ việc" ||
    s === "nghỉ hẳn" ||
    s === "nh" ||
    s === "bỏ xx" ||
    s === "bỏ xưởng" ||
    s === "hết hạn hợp đồng" ||
    s === "hết hợp đồng" ||
    s === "hhđ" ||
    s === "tự ý nghỉ việc"
  );
}

function isActiveAssignment(a: any): boolean {
  if (a.leaveDate) return false;
  if (isInactiveStatus(a.status)) return false;
  return true;
}

export async function GET(request: NextRequest) {
  const denied = await guard(request, "read");
  if (denied) return denied;

  try {
    const [workers, resolvedIds, sources] = await Promise.all([
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
    // TRƯỜNG HỢP 1: TRÙNG BỔ SUNG / GHI ĐÈ THÔNG TIN HỒ SƠ (MERGE_INFO)
    // =========================================================================
    const mergeInfoAlerts: any[] = [];

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
          v["Công ty"] || v["Nhà máy PV"] || v["Nhà máy làm việc"] || "",
        ).trim();
        const rawPv = formatExcelDate(
          v["Ngày PV"] || v["Ngày phỏng vấn"] || "",
        );
        const rawStatus = String(v["Tình trạng"] || "").trim();
        const rawCode = String(v["Mã NV"] || v["Mã nhân viên"] || "").trim();
        const rawGender = String(v["Giới tính"] || "").trim();
        const rawDob = formatExcelDate(v["Ngày sinh"] || "");
        const rawProvince = String(
          v["Tỉnh/Thành"] || v["Tỉnh"] || v["Quê quán"] || v["Địa chỉ"] || "",
        ).trim();
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
          (rawPhone ? workerByPhone.get(phoneKey(rawPhone)) : null) ||
          null;

        const matchedAssignment = matchedWorker
          ? (matchedWorker.assignments || []).find(
              (a: any) =>
                (rawCompany &&
                  (matchFactory(a.interviewFactory, rawCompany) ||
                    matchFactory(a.workingFactory, rawCompany))) ||
                (rawPv && dateKey(a.interviewDate) === dateKey(rawPv)),
            ) ||
            matchedWorker.assignments?.[0] ||
            null
          : null;

        const matchedBonus = matchedWorker
          ? (matchedWorker.bonusRecords || []).find(
              (b: any) =>
                !rawCompany || matchFactory(b.company || "", rawCompany),
            ) ||
            matchedWorker.bonusRecords?.[0] ||
            null
          : null;

        const dbBonusDetails = matchedBonus
          ? [1, 2, 3, 4, 5, 6, 7]
              .map((n) => {
                const val = matchedBonus[`bonus${n}`];
                return val
                  ? `L${n}: ${Number(val).toLocaleString("vi-VN")} đ`
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

        mergeInfoAlerts.push({
          id: alertId,
          category: "MERGE_INFO",
          type: "BỔ SUNG / GHI ĐÈ THÔNG TIN HỒ SƠ",
          severity: "WARNING",
          sourceId: source.id,
          row: row.row,
          fileName: source.file,
          importType: source.type,
          workerId: matchedWorker?.id || null,
          phone: rawPhone || matchedWorker?.phone || "",
          idCard: normCard || matchedWorker?.idCard || "—",
          fullName: rawName || matchedWorker?.fullName || "—",
          currentFactory:
            matchedAssignment?.workingFactory ||
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
            "Bấm 'Kiểm tra' để đối chiếu thông tin cũ - mới, bấm 'Duyệt' để ghi đè/bổ sung thông tin đầy đủ vào hồ sơ hoặc 'Xóa' để bỏ qua.",
          leftSide: {
            title: "Hồ sơ đang có trong hệ thống",
            fullName: matchedWorker?.fullName || "—",
            idCard: matchedWorker?.idCard || "—",
            phone: matchedWorker?.phone || "—",
            gender: matchedWorker?.gender || "—",
            dob: matchedWorker?.dob || "—",
            province: matchedWorker?.province || matchedWorker?.address || "—",
            employeeCode:
              matchedAssignment?.employeeCode ||
              matchedBonus?.workerCode ||
              matchedWorker?.code ||
              "—",
            factory:
              matchedAssignment?.workingFactory ||
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
            employeeCode: rawCode || "—",
            factory: rawCompany || "—",
            interviewDate: rawPv || "—",
            status: rawStatus || "—",
            leaveDate: formatExcelDate(v["Ngày NH"] || v["Ngày nghỉ"] || "") || "—",
            recruiter: rawRecruiter || "—",
            month: rawMonth || "—",
            totalBonus: rawTotalBonus || "—",
            bonusDetails: rawBonusDetails || "—",
            bankInfo: rawBank || "—",
          },
        });
      }
    }

    // =========================================================================
    // TRƯỜNG HỢP 2: ĐANG LÀM CÔNG TY NÀY NHƯNG PV / ĐI LÀM Ở CÔNG TY KHÁC
    // =========================================================================
    const crossCompanyAlerts: any[] = [];
    const phoneMap = new Map<string, typeof workers>();

    for (const w of workers) {
      if (w.assignments.length > 1) {
        const activeList = w.assignments.filter(isActiveAssignment);
        if (activeList.length > 0) {
          const otherAssignments = w.assignments.filter(
            (a) => !activeList.some((act) => act.id === a.id),
          );

          // Cả trường hợp có 2 đợt cùng đang active ở 2 công ty khác nhau, hoặc 1 đợt đang active nhưng phát sinh đợt PV ở công ty khác
          const comparePairs: Array<{ act: any; other: any }> = [];
          for (let i = 0; i < activeList.length; i++) {
            for (let j = i + 1; j < activeList.length; j++) {
              comparePairs.push({ act: activeList[j], other: activeList[i] });
            }
            for (const other of otherAssignments) {
              // Chỉ cảnh báo nếu đợt kia phát sinh mới hơn hoặc ở công ty khác chưa báo nghỉ ở công ty đang làm
              comparePairs.push({ act: activeList[i], other });
            }
          }

          const seenPairs = new Set<string>();
          for (const { act, other } of comparePairs) {
            const actFactory =
              act.workingFactory || act.interviewFactory || "Chưa rõ công ty";
            const otherFactory =
              other.workingFactory ||
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
                warning: `Đang làm việc tại "${actFactory}" (chưa báo nghỉ) nhưng lại có hồ sơ phỏng vấn / đi làm tại "${otherFactory}".`,
                actionRequired: `Bấm 'Duyệt' để chốt Đã nghỉ việc ở "${actFactory}" và giữ đợt ở "${otherFactory}", hoặc bấm 'Xóa' để hủy đợt trùng.`,
                leftSide: {
                  title: "Công ty đang làm việc (Chưa báo nghỉ)",
                  fullName: w.fullName,
                  idCard: w.idCard,
                  phone: w.phone || "—",
                  gender: w.gender || "—",
                  dob: w.dob || "—",
                  province: w.province || w.address || "—",
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
                  province: w.province || w.address || "—",
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

      if (w.phone) {
        const key = phoneKey(w.phone);
        if (key) {
          const list = phoneMap.get(key) || [];
          list.push(w);
          phoneMap.set(key, list);
        }
      }
    }

    // Quét thêm trường hợp SĐT đang đi làm ở công ty A nhưng lại đăng ký PV/đi làm ở công ty B
    phoneMap.forEach((list, phone) => {
      if (list.length > 1) {
        const activeWorker = list.find((w) =>
          w.assignments.some(isActiveAssignment),
        );
        if (activeWorker) {
          const actAssignment =
            activeWorker.assignments.find(isActiveAssignment);
          const actFactory =
            actAssignment?.workingFactory ||
            actAssignment?.interviewFactory ||
            "Chưa rõ";
          for (const otherWorker of list) {
            if (otherWorker.id !== activeWorker.id) {
              const alertId = `phone-active-${phone}-${otherWorker.id}`;
              if (resolvedIds.has(alertId)) continue;
              const otherAssignment = otherWorker.assignments[0];
              const otherFactory =
                otherAssignment?.workingFactory ||
                otherAssignment?.interviewFactory ||
                "Chưa rõ";
              crossCompanyAlerts.push({
                id: alertId,
                category: "CROSS_COMPANY",
                type: "ĐANG LÀM CÔNG TY NÀY NHƯNG PV / ĐI LÀM CÔNG TY KHÁC",
                severity: "CRITICAL",
                workerId: otherWorker.id,
                otherWorkerId: activeWorker.id,
                currentAssignmentId: actAssignment?.id || null,
                newAssignmentId: otherAssignment?.id || null,
                phone,
                idCard: otherWorker.idCard,
                fullName: otherWorker.fullName,
                currentFactory: actFactory,
                currentStatus: `${activeWorker.fullName} (Đang làm việc)`,
                currentInterviewDate: actAssignment?.interviewDate || "—",
                newFactory: otherFactory,
                newStatus: otherAssignment?.status || "Mới phát sinh",
                newInterviewDate: otherAssignment?.interviewDate || "—",
                recruiter:
                  otherAssignment?.recruiter || otherWorker.recruiter || "—",
                warning: `SĐT ${phone} đang đi làm tại "${actFactory}" (${activeWorker.fullName}) nhưng lại đăng ký phỏng vấn / đi làm tại "${otherFactory}" (${otherWorker.fullName}).`,
                actionRequired: `Bấm 'Kiểm tra' để đối chiếu 2 công ty, bấm 'Duyệt' nếu xác nhận hợp lệ hoặc 'Xóa' để xóa bản ghi trùng.`,
                leftSide: {
                  title: "Công ty đang làm việc (Trùng SĐT)",
                  fullName: activeWorker.fullName,
                  idCard: activeWorker.idCard,
                  phone: activeWorker.phone || phone,
                  gender: activeWorker.gender || "—",
                  dob: activeWorker.dob || "—",
                  province: activeWorker.province || activeWorker.address || "—",
                  factory: actFactory,
                  interviewDate: actAssignment?.interviewDate || "—",
                  startDate: actAssignment?.startDate || "—",
                  leaveDate: actAssignment?.leaveDate || "Chưa có ngày nghỉ",
                  status: actAssignment?.status || "Đang làm việc",
                  employeeCode:
                    actAssignment?.employeeCode || activeWorker.code || "—",
                  recruiter:
                    actAssignment?.recruiter || activeWorker.recruiter || "—",
                },
                rightSide: {
                  title: "Công ty mới phỏng vấn / đi làm",
                  fullName: otherWorker.fullName,
                  idCard: otherWorker.idCard,
                  phone: otherWorker.phone || phone,
                  gender: otherWorker.gender || "—",
                  dob: otherWorker.dob || "—",
                  province: otherWorker.province || otherWorker.address || "—",
                  factory: otherFactory,
                  interviewDate: otherAssignment?.interviewDate || "—",
                  startDate: otherAssignment?.startDate || "—",
                  leaveDate: otherAssignment?.leaveDate || "—",
                  status: otherAssignment?.status || "—",
                  employeeCode:
                    otherAssignment?.employeeCode || otherWorker.code || "—",
                  recruiter:
                    otherAssignment?.recruiter || otherWorker.recruiter || "—",
                },
              });
            }
          }
        }
      }
    });

    const allAlerts = [...mergeInfoAlerts, ...crossCompanyAlerts];

    return NextResponse.json({
      success: true,
      totalDuplicates: allAlerts.length,
      counts: {
        mergeInfoCount: mergeInfoAlerts.length,
        crossCompanyCount: crossCompanyAlerts.length,
      },
      data: allAlerts,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: "Không thể xử lý yêu cầu lúc này" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await guard(request, "worker:write");
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

      const raw = targetRow.values || {};
      const importType = targetSource.type;

      await prisma.$transaction(async (tx) => {
        if (importType === "DS_THUONG") {
          const parsed = parseBonusImportRow(raw);
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
          } else if (parsedName && worker.fullName !== parsedName) {
            worker = await tx.worker.update({
              where: { id: worker.id },
              data: { fullName: parsedName },
              include: { assignments: true },
            });
          }

          const matchedAssignment =
            (worker.assignments || []).find(
              (a: any) =>
                matchFactory(
                  a.workingFactory || a.interviewFactory || "",
                  company,
                ) &&
                (!interviewDate ||
                  dateKey(a.interviewDate) === dateKey(interviewDate)),
            ) ||
            worker.assignments?.[0] ||
            null;

          const existingBonus = await tx.bonusRecord.findFirst({
            where: {
              workerId: worker.id,
              month,
              company,
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
            await tx.worker.update({
              where: { id: person.id },
              data: cleanWorkerData,
            });
          }

          const matchedAssignment = (person.assignments || []).find(
            (a: any) =>
              matchFactory(
                a.interviewFactory || "",
                assignment.interviewFactory || "",
              ) && dateKey(a.interviewDate) === dateKey(assignment.interviewDate),
          );
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
              data: cleanAssignmentData,
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
    if (action === "APPROVE") {
      if (currentAssignmentId && !String(id).startsWith("phone-active-")) {
        const leaveDay =
          newInterviewDate && newInterviewDate !== "—"
            ? String(newInterviewDate)
            : today();
        await prisma.$transaction(async (tx) => {
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
                  "Chuyển công ty mới (Đã duyệt cảnh báo trùng)",
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
          await tx.auditLog.create({
            data: {
              module: "DUPLICATE",
              action: "APPROVE",
              operator: actor.username,
              details: `Duyệt cảnh báo nhảy xưởng cho ${fullName || ""} (${idCard || ""}): chốt nghỉ đợt cũ ${currentAssignmentId}`,
            },
          });
        });
      } else {
        await prisma.auditLog.create({
          data: {
            module: "DUPLICATE",
            action: "APPROVE",
            operator: actor.username,
            details: `Xác nhận hợp lệ cảnh báo trùng [${type || id}] của ${fullName || ""} (${idCard || ""})`,
          },
        });
      }

      await addResolvedId(String(id));
      return NextResponse.json({
        success: true,
        message:
          "Đã duyệt: chốt trạng thái Đã nghỉ việc ở công ty cũ và giữ đợt tại công ty mới",
      });
    }

    // action === "DELETE" cho Trường hợp 2
    const targetAssignmentId = newAssignmentId || currentAssignmentId;
    await prisma.$transaction(async (tx) => {
      if (targetAssignmentId) {
        const existingAssign = await tx.workAssignment.findUnique({
          where: { id: String(targetAssignmentId) },
        });
        if (existingAssign) {
          await tx.workAssignment.delete({
            where: { id: existingAssign.id },
          });
          const remainingCount = await tx.workAssignment.count({
            where: { workerId: existingAssign.workerId },
          });
          if (remainingCount === 0) {
            await tx.worker.delete({
              where: { id: existingAssign.workerId },
            });
          }
        }
      } else if (workerId) {
        const count = await tx.workAssignment.count({
          where: { workerId: String(workerId) },
        });
        if (count === 0) {
          await tx.worker.delete({ where: { id: String(workerId) } });
        }
      }

      await tx.auditLog.create({
        data: {
          module: "DUPLICATE",
          action: "DELETE",
          operator: actor.username,
          details: `Xóa đợt tuyển trùng lặp [${type || id}] của ${fullName || ""} (${idCard || ""})`,
        },
      });
    });

    await addResolvedId(String(id));
    return NextResponse.json({
      success: true,
      message: "Đã xóa bản ghi đợt trùng lặp khỏi hệ thống",
    });
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
