import { guard, identity } from "@/lib/local-request";
import { NextRequest, NextResponse } from "next/server";
export async function POST(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Dữ liệu JSON không hợp lệ" },
      { status: 400 },
    );
  }
  if (
    typeof body?.bankName !== "string" ||
    !body.bankName.trim() ||
    typeof body?.accountNumber !== "string" ||
    !/^\d{1,34}$/.test(body.accountNumber.trim())
  ) {
    return NextResponse.json(
      {
        success: false,
        message: "Vui lòng cung cấp ngân hàng và số tài khoản hợp lệ",
      },
      { status: 400 },
    );
  }
  return NextResponse.json(
    {
      success: false,
      code: "BANK_VERIFICATION_UNAVAILABLE",
      message:
        "Chưa kết nối dịch vụ xác minh ngân hàng. Tên nhập thủ công chỉ dùng đối chiếu, chưa đủ điều kiện xuất lệnh chi.",
    },
    { status: 503 },
  );
}
