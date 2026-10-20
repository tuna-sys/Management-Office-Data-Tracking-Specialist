import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, sameOrigin } from "@/lib/local-request";
import { phoneKey } from "@/lib/worker-validation";
import { createHash } from "node:crypto";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { success: false, message: "Nguồn yêu cầu không hợp lệ" },
      { status: 403 },
    );
  }

  if (!rateLimit("lookup:global", 100)) {
    return NextResponse.json(
      {
        success: false,
        message: "Quá nhiều lần tra cứu. Thử lại sau 15 phút.",
      },
      { status: 429 },
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  const idCard = typeof body?.idCard === "string" ? body.idCard.trim() : "";
  const code =
    typeof body?.code === "string"
      ? body.code.trim()
      : typeof body?.employeeCode === "string"
        ? body.employeeCode.trim()
        : typeof body?.workerCode === "string"
          ? body.workerCode.trim()
          : "";
  const lastPhone4 =
    typeof body?.lastPhone4 === "string" ? body.lastPhone4.trim() : "";

  if (!idCard && !code) {
    return NextResponse.json(
      {
        success: false,
        message: "Vui lòng nhập Số CCCD hoặc Mã Nhân Viên để tra cứu",
      },
      { status: 400 },
    );
  }

  if (idCard && !/^(\d{9}|\d{12})$/.test(idCard)) {
    return NextResponse.json(
      {
        success: false,
        message: "Cần CCCD 12 số hoặc CMT 9 số hợp lệ",
      },
      { status: 400 },
    );
  }

  if (lastPhone4 && !code && !/^\d{4}$/.test(lastPhone4)) {
    return NextResponse.json(
      {
        success: false,
        message: "Cần CCCD 12 số hoặc CMT 9 số và đúng 4 số cuối SĐT",
      },
      { status: 400 },
    );
  }

  const rateKey = idCard || code.toUpperCase();
  if (
    !rateLimit(
      "lookup:" + createHash("sha256").update(rateKey).digest("hex"),
      10,
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        message: "Quá nhiều lần tra cứu. Thử lại sau 15 phút.",
      },
      { status: 429 },
    );
  }

  try {
    const includeConfig = {
      assignments: {
        include: {
          order: true,
          batch: true,
          bonusRecords: {
            where: { status: { in: ["APPROVED", "LOCKED"] } },
            orderBy: { createdAt: "desc" as const },
          },
          enrollments: {
            include: {
              stages: {
                include: { payments: true },
                orderBy: { step: "asc" as const },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
      },
      bonusRecords: {
        where: { status: { in: ["APPROVED", "LOCKED"] } },
        orderBy: { createdAt: "desc" as const },
      },
      bankAccounts: {
        orderBy: { createdAt: "desc" as const },
      },
    };

    const codeVariants = code
      ? Array.from(new Set([code, code.toUpperCase(), code.toLowerCase()]))
      : [];

    // Tìm theo CCCD (nếu có) hoặc tìm trực tiếp theo Mã nhân viên
    const worker = idCard
      ? await prisma.worker.findUnique({
          where: { idCard },
          include: includeConfig,
        })
      : await prisma.worker.findFirst({
          where: {
            OR: [
              { code: { in: codeVariants } },
              {
                assignments: {
                  some: { employeeCode: { in: codeVariants } },
                },
              },
              {
                bonusRecords: {
                  some: { workerCode: { in: codeVariants } },
                },
              },
            ],
          },
          include: includeConfig,
        });

    if (!worker) {
      return NextResponse.json(
        { success: false, message: "Thông tin tra cứu không khớp hồ sơ" },
        { status: 404 },
      );
    }

    // Nếu nhập cả CCCD và Mã NV thì kiểm tra khớp cả 2; nếu có lastPhone4 thì kiểm tra 4 số cuối SĐT
    if (idCard && code) {
      const normInput = code.trim().toLowerCase();
      const codeMatchesWorker =
        worker.code && worker.code.trim().toLowerCase() === normInput;
      const codeMatchesAssignment = worker.assignments?.some(
        (a) =>
          a.employeeCode && a.employeeCode.trim().toLowerCase() === normInput,
      );
      const codeMatchesBonus = worker.bonusRecords?.some(
        (b) =>
          b.workerCode && b.workerCode.trim().toLowerCase() === normInput,
      );
      if (!codeMatchesWorker && !codeMatchesAssignment && !codeMatchesBonus) {
        return NextResponse.json(
          { success: false, message: "Số CCCD và Mã nhân viên không khớp cùng một hồ sơ" },
          { status: 404 },
        );
      }
    } else if (lastPhone4) {
      if (!worker.phone || !phoneKey(worker.phone).endsWith(lastPhone4)) {
        return NextResponse.json(
          { success: false, message: "Thông tin tra cứu không khớp hồ sơ" },
          { status: 404 },
        );
      }
    }

    const b = worker.bankAccounts[0];

    // Chuẩn hóa và bóc tách dữ liệu theo từng công ty người này từng làm
    const companies = worker.assignments.map((a) => {
      // Danh sách các đợt trả thưởng đạt mốc công thực tế
      const payments = a.enrollments.flatMap((e) =>
        e.stages.flatMap((s) =>
          s.payments.map((p) => ({
            id: p.id,
            stageLabel: s.label,
            amount: p.amount,
            paidOn: p.paidOn,
            reference: p.reference,
            note: p.note,
          })),
        ),
      );

      // Bảng thưởng theo kỳ (DS_THUONG)
      const linkedBonuses = worker.bonusRecords.filter(
        (r) =>
          r.assignmentId === a.id ||
          (r.company &&
            r.company === a.interviewFactory),
      );

      const totalBonusFromRecords = linkedBonuses.reduce(
        (sum, r) => sum + (r.totalBonus || 0),
        0,
      );
      const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0);

      return {
        id: a.id,
        factory: a.interviewFactory,
        interviewFactory: a.interviewFactory,
        contractType: a.contractType || "Thời vụ",
        status: a.status,
        interviewDate: a.interviewDate || "—",
        startDate: a.startDate || a.passedDate || a.interviewDate || "—",
        leaveDate: a.leaveDate || null,
        leaveReason: a.leaveReason || null,
        confirmedWorkDays: a.confirmedWorkDays,
        onboardingMonth: a.onboardingMonth,
        recruiter: a.recruiter || "—",
        createdAt: a.createdAt,
        payments,
        bonuses: linkedBonuses.map((r) => ({
          id: r.id,
          month: r.month,
          totalBonus: r.totalBonus || 0,
          bonus1: r.bonus1 || 0,
          bonus2: r.bonus2 || 0,
          bonus3: r.bonus3 || 0,
          bonus4: r.bonus4 || 0,
          status: r.status,
        })),
        totalBonus: totalPayments > 0 ? totalPayments : totalBonusFromRecords,
      };
    });

    const primaryAssignment = worker.assignments[0];

    return NextResponse.json(
      {
        success: true,
        data: {
          id: worker.id,
          code:
            worker.code ||
            primaryAssignment?.employeeCode ||
            worker.bonusRecords[0]?.workerCode ||
            null,
          idCardDisplay: worker.idCard,
          fullName: worker.fullName,
          phone: worker.phone
            ? worker.phone.slice(0, 3) + "••••" + worker.phone.slice(-3)
            : null,
          totalCompaniesWorked: companies.length,
          companies,
          // Tương thích ngược:
          assignment: primaryAssignment
            ? {
                status: primaryAssignment.status,
                interviewFactory: primaryAssignment.interviewFactory,
                onboardingMonth: primaryAssignment.onboardingMonth,
              }
            : null,
          bonusRecords: worker.bonusRecords.map((r) => ({
            id: r.id,
            month: r.month,
            status: r.status,
            bonus1: r.bonus1,
            bonus2: r.bonus2,
            bonus3: r.bonus3,
            bonus4: r.bonus4,
            bonus5: r.bonus5,
            bonus6: r.bonus6,
            bonus7: r.bonus7,
            totalBonus: r.totalBonus,
          })),
          bankAccount: b
            ? {
                accountNumber: "••••" + b.accountNumber.slice(-4),
                bankName: b.bankName,
                accountHolderName: b.accountHolderName,
              }
            : null,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { success: false, message: "Không thể tra cứu lúc này" },
      { status: 500 },
    );
  }
}
