import { NextRequest, NextResponse } from "next/server";
import { guard, identity } from "@/lib/auth";
import {
  readImportSources,
  deleteImportSource,
  resolveImportSourceRow,
} from "@/lib/import-source-store";
import { splitImportReview } from "@/lib/import-review";
import { prisma } from "@/lib/prisma";
import {
  normalizeCccd,
  phoneKey,
  dateKey,
  formatExcelDate,
} from "@/lib/worker-validation";
import { parseBonusImportRow, readBonusValue } from "@/lib/bonus-import";
import { parseImportRow } from "@/lib/worker-import";
import { today } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const [sources, workers] = await Promise.all([
      readImportSources(),
      prisma.worker.findMany({
        include: {
          assignments: { orderBy: { createdAt: "desc" } },
          bonusRecords: { orderBy: { createdAt: "desc" } },
          bankAccounts: { orderBy: { createdAt: "desc" } },
        },
      }),
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

    const warnings: any[] = [],
      duplicates: any[] = [];
    for (const source of sources) {
      for (const row of source.rows || []) {
        const review = splitImportReview([
          ...(row.warnings || []),
          ...(row.duplicates || []),
        ]);
        if (!review.duplicates.length && !review.warnings.length) continue;

        const v = row.values || {};
        const rawCard = v["Số CCCD"] || v["số CCCD"] || v["CCCD"] || "";
        const normCard = normalizeCccd(rawCard);
        const rawPhone = v["SĐT"] || v["Số điện thoại"] || "";
        const pk = rawPhone ? phoneKey(String(rawPhone)) : "";
        const rawCompany = String(
          v["Công ty"] || v["Nhà máy PV"] || v["Nhà máy làm việc"] || "",
        ).trim();
        const rawPv = formatExcelDate(
          v["Ngày PV"] || v["Ngày phỏng vấn"] || "",
        );

        const matchedWorker =
          (normCard ? workerByCard.get(normCard) : null) ||
          (pk ? workerByPhone.get(pk) : null) ||
          null;

        let matchedAssignment = null;
        let matchedBonus = null;
        if (matchedWorker) {
          matchedAssignment =
            (matchedWorker.assignments || []).find(
              (a: any) =>
                (rawCompany &&
                  (a.interviewFactory === rawCompany ||
                    a.workingFactory === rawCompany)) ||
                (rawPv && dateKey(a.interviewDate) === dateKey(rawPv)),
            ) ||
            matchedWorker.assignments?.[0] ||
            null;

          matchedBonus =
            (matchedWorker.bonusRecords || []).find(
              (b: any) => !rawCompany || (b.company || "") === rawCompany,
            ) ||
            matchedWorker.bonusRecords?.[0] ||
            null;
        }

        const existingRecord = matchedWorker
          ? {
              workerId: matchedWorker.id,
              fullName: matchedWorker.fullName,
              idCard: matchedWorker.idCard,
              phone: matchedWorker.phone,
              dob: matchedWorker.dob,
              gender: matchedWorker.gender,
              address: matchedWorker.address,
              province: matchedWorker.province,
              recruiter:
                matchedAssignment?.recruiter || matchedWorker.recruiter || "",
              team: matchedAssignment?.team || matchedWorker.team || "",
              interviewFactory: matchedAssignment?.interviewFactory || "",
              workingFactory: matchedAssignment?.workingFactory || "",
              interviewDate: matchedAssignment?.interviewDate || "",
              status: matchedAssignment?.status || "",
              employeeCode:
                matchedAssignment?.employeeCode || matchedWorker.code || "",
              leaveDate: matchedAssignment?.leaveDate || "",
              bonusMonth: matchedBonus?.month || "",
              bonusCompany: matchedBonus?.company || "",
              bonusPolicy: matchedBonus?.policy || "",
              bonus1: matchedBonus?.bonus1 || 0,
              bonus2: matchedBonus?.bonus2 || 0,
              bonus3: matchedBonus?.bonus3 || 0,
              bonus4: matchedBonus?.bonus4 || 0,
              bonus5: matchedBonus?.bonus5 || 0,
              bonus6: matchedBonus?.bonus6 || 0,
              bonus7: matchedBonus?.bonus7 || 0,
              totalBonus: matchedBonus?.totalBonus || 0,
              accountNumber:
                matchedWorker.bankAccounts?.[0]?.accountNumber || "",
              bankName: matchedWorker.bankAccounts?.[0]?.bankName || "",
            }
          : null;

        const common = {
          id: `${source.id}-${row.row}`,
          sourceId: source.id,
          file: source.file,
          sheet: source.sheet,
          importType: source.type,
          row: row.row,
          values: row.values,
          existingRecord,
        };
        if (review.duplicates.length)
          duplicates.push({
            ...common,
            issues: [...review.duplicates, ...review.warnings],
          });
        else if (review.warnings.length)
          warnings.push({ ...common, issues: review.warnings });
      }
    }
    return NextResponse.json({
      success: true,
      data: { warnings, duplicates },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Không tải được danh sách phân luồng import",
      },
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
    const { action, sourceId, row } = body || {};
    if (!sourceId || row == null || !["APPROVE", "DELETE"].includes(action)) {
      return NextResponse.json(
        { success: false, message: "Thiếu thông tin dòng hoặc thao tác" },
        { status: 400 },
      );
    }

    if (action === "DELETE") {
      const removed = await resolveImportSourceRow(
        String(sourceId),
        Number(row),
        "DELETE",
      );
      if (!removed) {
        return NextResponse.json(
          { success: false, message: "Không tìm thấy dòng kiểm tra để xóa" },
          { status: 404 },
        );
      }
      await prisma.auditLog.create({
        data: {
          module: "IMPORT_REVIEW",
          action: "DELETE",
          operator: actor.username,
          details: `Xóa dòng kiểm tra #${row} thuộc file ${removed.source.file}`,
        },
      });
      return NextResponse.json({
        success: true,
        message: `Đã xóa dòng #${row} khỏi danh sách kiểm tra`,
      });
    }

    // action === "APPROVE"
    const sources = await readImportSources();
    const targetSource = sources.find((s: any) => s.id === String(sourceId));
    const targetRow = (targetSource?.rows || []).find(
      (r: any) => Number(r.row) === Number(row),
    );
    if (!targetSource || !targetRow) {
      return NextResponse.json(
        { success: false, message: "Không tìm thấy dòng dữ liệu để duyệt" },
        { status: 404 },
      );
    }

    const raw = targetRow.values || {};
    const importType = targetSource.type;

    await prisma.$transaction(async (tx) => {
      if (importType === "DS_THUONG") {
        const parsed = parseBonusImportRow(raw);
        const {
          sequence,
          idCard,
          fullName,
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
          where: { idCard },
          include: { assignments: true },
        });
        if (!worker) {
          worker = await tx.worker.create({
            data: { idCard, fullName: fullName || "Chưa rõ tên" },
            include: { assignments: true },
          });
        } else if (fullName && worker.fullName !== fullName) {
          worker = await tx.worker.update({
            where: { id: worker.id },
            data: { fullName },
            include: { assignments: true },
          });
        }

        const matchedAssignment =
          (worker.assignments || []).find(
            (a: any) =>
              (a.workingFactory || a.interviewFactory) === company &&
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
              bonus1,
              bonus2,
              bonus3,
              bonus4,
              bonus5,
              bonus6,
              bonus7,
              totalBonus,
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
                accountHolderName: fullName || worker.fullName,
                isNameVerified: true,
                verificationStatus: "VERIFIED",
              },
            });
          }
        }
      } else {
        // DS_TONG or other profile row
        const { worker, assignment } = parseImportRow(raw, true);
        let person = await tx.worker.findUnique({
          where: { idCard: worker.idCard },
          include: { assignments: true },
        });
        const cleanWorkerData = Object.fromEntries(
          Object.entries(worker).filter(
            ([_, val]) => val !== undefined && val !== null && String(val).trim() !== "",
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
            a.interviewFactory === assignment.interviewFactory &&
            dateKey(a.interviewDate) === dateKey(assignment.interviewDate),
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
              note: `Import Excel (Đã duyệt trùng lặp dòng #${row})`,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          module: "IMPORT_REVIEW",
          action: "APPROVE",
          operator: actor.username,
          details: `Duyệt dòng kiểm tra #${row} (${importType}) thuộc file ${targetSource.file}`,
        },
      });
    });

    await resolveImportSourceRow(String(sourceId), Number(row), "APPROVE");

    return NextResponse.json({
      success: true,
      message: `Đã duyệt và cập nhật dữ liệu dòng #${row} vào hệ thống`,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        message: "Không thể xử lý dòng kiểm tra: " + (err?.message || "Lỗi"),
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guard(request, "worker:write");
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const sourceId = url.searchParams.get("sourceId") || undefined;
    await deleteImportSource(sourceId);
    return NextResponse.json({
      success: true,
      message: sourceId
        ? "Đã xóa bản ghi nguồn kiểm tra"
        : "Đã dọn sạch toàn bộ lịch sử kiểm tra",
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        message: "Không thể xóa lịch sử kiểm tra: " + (err?.message || ""),
      },
      { status: 500 },
    );
  }
}

