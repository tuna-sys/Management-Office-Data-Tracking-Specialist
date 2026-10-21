import { guard, identity } from "@/lib/local-request";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
// Hàm chuẩn hóa chuỗi tiếng Việt so sánh tên
function normalizeName(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}
export async function GET(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get("filter") || "ALL"; // ALL, MISMATCH, VALID, AUTHORIZED
    const search = searchParams.get("search") || "";
    const accounts = await prisma.bankAccount.findMany({
      include: {
        worker: {
          include: {
            assignments: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    let filtered = accounts;
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.accountNumber.includes(s) ||
          a.accountHolderName.toLowerCase().includes(s) ||
          a.worker.fullName.toLowerCase().includes(s) ||
          a.worker.idCard.includes(s),
      );
    }
    if (filter === "UNVERIFIED") {
      filtered = filtered.filter((a) => a.verificationStatus === "UNVERIFIED");
    } else if (filter === "MISMATCH") {
      filtered = filtered.filter((a) => a.verificationStatus === "MISMATCH");
    } else if (filter === "VALID") {
      filtered = filtered.filter((a) => a.verificationStatus === "VALID");
    } else if (filter === "AUTHORIZED") {
      filtered = filtered.filter((a) => a.verificationStatus === "AUTHORIZED");
    }
    return NextResponse.json({ success: true, data: filtered });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: "Không thể xử lý yêu cầu lúc này" },
      { status: 500 },
    );
  }
}
export async function POST(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const {
      workerId,
      bankName,
      accountNumber,
      accountHolderName,
      isAuthorized = false,
      authorizedRelation = "",
    } = body || {};
    if (
      typeof workerId !== "string" ||
      !workerId.trim() ||
      typeof bankName !== "string" ||
      !bankName.trim() ||
      bankName.length > 200 ||
      typeof accountNumber !== "string" ||
      !/^\d{1,34}$/.test(accountNumber.trim()) ||
      typeof accountHolderName !== "string" ||
      !accountHolderName.trim() ||
      accountHolderName.length > 200 ||
      typeof isAuthorized !== "boolean" ||
      (isAuthorized &&
        (typeof authorizedRelation !== "string" || !authorizedRelation.trim()))
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Thông tin tài khoản hoặc quan hệ nhận thay chưa hợp lệ",
        },
        { status: 400 },
      );
    }
    const worker = await prisma.worker.findUnique({
      where: { id: workerId },
    });
    if (!worker) {
      return NextResponse.json(
        { success: false, message: "Không tìm thấy hồ sơ người lao động" },
        { status: 404 },
      );
    }
    const isMatch =
      normalizeName(worker.fullName) === normalizeName(accountHolderName);
    const verificationStatus = "UNVERIFIED";
    const warningMessage = isMatch
      ? "Tên nhập thủ công khớp hồ sơ; chưa xác minh với ngân hàng"
      : "Tên nhập thủ công lệch hồ sơ; cần xác minh ngân hàng và giấy ủy quyền nếu nhận thay";
    const actor = (await identity(request))!;
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.bankAccount.create({
        data: {
          workerId,
          bankName,
          accountNumber: accountNumber.trim(),
          accountHolderName: accountHolderName.toUpperCase().trim(),
          isNameVerified: false,
          isAuthorized,
          authorizedRelation,
          verificationStatus,
          warningMessage,
          checkedBy: null,
          checkResult: warningMessage,
          checkedAt: null,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "CREATE",
          module: "BANK",
          operator: actor.username,
          details: `Thêm tài khoản ${created.id} cho hồ sơ ${workerId}; chưa xác minh ngân hàng`,
        },
      });
      return created;
    });
    return NextResponse.json({ success: true, data: account });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: "Không thể xử lý yêu cầu lúc này" },
      { status: 500 },
    );
  }
}
export async function PUT(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "JSON không hợp lệ" },
      { status: 400 },
    );
  }
  if (
    typeof body?.id !== "string" ||
    typeof body.bankName !== "string" ||
    !body.bankName.trim() ||
    body.bankName.length > 200 ||
    typeof body.accountNumber !== "string" ||
    !/^\d{1,34}$/.test(body.accountNumber.trim()) ||
    typeof body.accountHolderName !== "string" ||
    !body.accountHolderName.trim() ||
    body.accountHolderName.length > 200 ||
    typeof body.isAuthorized !== "boolean" ||
    (body.isAuthorized &&
      (typeof body.authorizedRelation !== "string" ||
        !body.authorizedRelation.trim()))
  )
    return NextResponse.json(
      { success: false, message: "Thông tin tài khoản không hợp lệ" },
      { status: 400 },
    );
  const actor = (await identity(request))!;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.bankAccount.findUnique({
        where: { id: body.id },
        include: { worker: true },
      });
      if (!current) return { error: "Không tìm thấy tài khoản", status: 404 };
      if (body.updatedAt !== current.updatedAt.toISOString())
        return { error: "Tài khoản đã thay đổi, hãy tải lại", status: 409 };
      const isMatch =
        normalizeName(current.worker.fullName) ===
        normalizeName(body.accountHolderName);
      const warningMessage = isMatch
        ? "Tên nhập thủ công khớp hồ sơ; chưa xác minh ngân hàng"
        : "Tên nhập thủ công lệch hồ sơ; cần xác minh ngân hàng và giấy ủy quyền nếu nhận thay";
      const data = await tx.bankAccount.update({
        where: { id: current.id },
        data: {
          bankName: body.bankName.trim(),
          accountNumber: body.accountNumber.trim(),
          accountHolderName: body.accountHolderName.trim().toUpperCase(),
          isAuthorized: body.isAuthorized,
          authorizedRelation: body.isAuthorized
            ? body.authorizedRelation.trim()
            : null,
          verificationStatus: "UNVERIFIED",
          isNameVerified: false,
          checkedBy: null,
          checkedAt: null,
          checkResult: warningMessage,
          warningMessage,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          module: "BANK",
          operator: actor.username,
          details: `Sửa tài khoản ${current.id}; trạng thái trở về chưa xác minh ngân hàng`,
        },
      });
      return { data };
    });
    if ("error" in result)
      return NextResponse.json(
        { success: false, message: result.error },
        { status: result.status },
      );
    return NextResponse.json({ success: true, data: result.data });
  } catch {
    return NextResponse.json(
      { success: false, message: "Không thể cập nhật tài khoản" },
      { status: 500 },
    );
  }
}
