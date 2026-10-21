import { guard } from "@/lib/local-request";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { paymentIssue, validMonth } from "@/lib/payment-safety";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "PAYMENT_BATCH";
  const bank = searchParams.get("bank") || "VCB";
  const month = searchParams.get("month") || "";

  // Mẫu file mẫu (TEMPLATE) cho phép tải an toàn không chứa dữ liệu nhạy cảm
  if (!type.startsWith("TEMPLATE")) {
    const denied = await guard(request);
    if (denied) return denied;
  }

  try {
    // 1. Xuất Lệnh Chi Ngân Hàng
    if (type === "PAYMENT_BATCH") {
      if (!validMonth(month))
        return NextResponse.json(
          { success: false, message: "Cần chọn kỳ tháng hợp lệ" },
          { status: 400 },
        );

      const bonuses = await prisma.bonusRecord.findMany({
        where: {
          month,
          totalBonus: { gt: 0 },
        },
        include: {
          worker: {
            include: {
              bankAccounts: true,
            },
          },
        },
      });

      if (!bonuses.length)
        return NextResponse.json(
          { success: false, message: "Không có thưởng dương trong kỳ đã chọn" },
          { status: 409 },
        );

      const issues = bonuses
        .map((b) => ({ id: b.id, reason: paymentIssue(b) }))
        .filter((b) => b.reason);
      if (issues.length)
        return NextResponse.json(
          {
            success: false,
            code: "PAYMENT_BATCH_BLOCKED",
            message: `Chưa thể xuất lệnh chi: ${issues.length} bản ghi chưa đủ điều kiện. ${issues[0].reason}.`,
            issues,
          },
          { status: 409 },
        );

      const paymentRows = bonuses.map((b, idx) => {
        const bankAcc = b.worker.bankAccounts[0];
        return {
          STT: idx + 1,
          "Số tài khoản nhận": bankAcc?.accountNumber || "CHƯA CÓ STK",
          "Tên người thụ hưởng":
            bankAcc?.accountHolderName || b.worker.fullName,
          "Số tiền (VND)": b.totalBonus || 0,
          "Tên ngân hàng": bankAcc?.bankName || "N/A",
          "Nội dung thanh toán": `Chi trả thưởng ${b.month} - ${b.worker.fullName}`,
          CCCD: b.worker.idCard,
          "Nhà máy": b.company || "N/A",
          "Trạng thái STK": bankAcc?.verificationStatus || "Chưa kiểm tra",
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(paymentRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, `ChiThuong_${month}`);
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      return new NextResponse(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="LenhChi_${bank}_${month}.xlsx"`,
        },
      });
    }

    // 2. Xuất File Cảnh Báo Trùng
    if (type === "DUPLICATES") {
      const { GET } = await import("@/app/api/duplicates/route");
      const result = await GET(request);
      if (!result.ok) return result;
      const json = await result.json();
      const rows = json.data.map((d: any) => ({
        CCCD: d.idCard,
        "Họ và Tên": d.fullName,
        "Nhà máy PV": d.factory,
        "Tình Trạng": d.status,
        "Ngày PV": d.interviewDate,
        "Loại Cảnh Báo": d.type,
        "Chi Tiết": d.warning,
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(rows),
        "Cảnh báo trùng",
      );
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      return new NextResponse(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="CanhBaoTrung.xlsx"',
          "Cache-Control": "no-store",
        },
      });
    }

    // 3. Mẫu Form DS_TONG chuẩn 100% khớp các cột của người dùng
    if (type === "TEMPLATE" || type === "TEMPLATE_DS_TONG") {
      const headers = [
        "STT",
        "Nhà máy PV",
        "Loại HD",
        "Tình trạng",
        "Ngày NH",
        "Lý do",
        "Mã NV",
        "Họ và tên",
        "Ngày sinh",
        "Giới tính",
        "số CCCD",
        "Ngày cấp",
        "Địa chỉ",
        "SĐT",
        "Tuyển dụng",
        "Đón xe - KTX",
        "Ngày PV",
        "Ngày Đào tạo dự kiến",
        "Tình trạng Đào tạo dự kiến",
        "Ngày đào tạo chuẩn",
        "Tháng nhận việc",
        "Nguồn",
      ];

      const sampleRows = [
        headers,
        [
          1,
          "Luxshare QC",
          "Thời vụ",
          "Đang làm việc",
          "",
          "",
          "005014",
          "Nguyễn Văn A",
          "15/05/2000",
          "Nam",
          "038096001234",
          "15/05/2021",
          "Hà Nội",
          "0987654321",
          "Đỗ Tuấn Anh",
          "Có xe đón",
          "05/01/2026",
          "07/01/2026",
          "Đã đào tạo",
          "08/01/2026",
          "T01.2026",
          "Tuyển dụng trực tiếp",
        ],
      ];

      const sampleRowsThangCu = [
        headers,
        // 1. Người mới đang làm việc
        [
          1,
          "Luxshare QC",
          "Thời vụ",
          "Đang làm việc",
          "",
          "",
          "004812",
          "Vũ Thị Lan",
          "10/08/2001",
          "Nữ",
          "038198004112",
          "10/05/2021",
          "Bắc Ninh",
          "0981112233",
          "Hoàng Văn Hưng",
          "Có xe đón",
          "10/12/2025",
          "12/12/2025",
          "Đã đào tạo",
          "13/12/2025",
          "T12.2025",
          "Trực tiếp",
        ],
        // 2. Người cũ (Tái tuyển / Làm nhiều công ty) - Đợt trước ở Canon
        [
          2,
          "Canon",
          "Thời vụ",
          "Đang làm việc",
          "",
          "",
          "003290",
          "Trần Văn Nam",
          "22/03/1997",
          "Nam",
          "037097003290",
          "15/04/2020",
          "Bắc Giang",
          "0972223344",
          "Đỗ Tuấn Anh",
          "Tự túc",
          "05/11/2025",
          "07/11/2025",
          "Đã đào tạo",
          "08/11/2025",
          "T11.2025",
          "Fanpage tuyển dụng",
        ],
        // 3. Người đã nghỉ việc - Lý do: Việc gia đình
        [
          3,
          "Goertek",
          "Thời vụ",
          "Đã nghỉ việc",
          "28/12/2025",
          "Việc gia đình",
          "002911",
          "Lê Văn Tuấn",
          "14/09/1995",
          "Nam",
          "024095003456",
          "20/08/2019",
          "Thái Nguyên",
          "0963334455",
          "Nguyễn Thu Trang",
          "Có xe đón",
          "01/10/2025",
          "03/10/2025",
          "Đã đào tạo",
          "04/10/2025",
          "T10.2025",
          "Tuyển dụng trực tiếp",
        ],
        // 4. Người đã nghỉ việc - Lý do: Hết hạn hợp đồng
        [
          4,
          "Fushan",
          "Thời vụ",
          "Đã nghỉ việc",
          "30/12/2025",
          "Hết hạn hợp đồng",
          "001855",
          "Bùi Thị Hằng",
          "05/11/1999",
          "Nữ",
          "019199001855",
          "12/03/2022",
          "Hải Dương",
          "0914445566",
          "Lê Thanh Mai",
          "Tự túc",
          "15/09/2025",
          "17/09/2025",
          "Đã đào tạo",
          "18/09/2025",
          "T09.2025",
          "Người quen giới thiệu",
        ],
        // 5. Người cũ (Tái tuyển / Làm nhiều công ty) - Đợt trước ở Foxconn
        [
          5,
          "Foxconn",
          "Thời vụ",
          "Đang làm việc",
          "",
          "",
          "005420",
          "Phạm Quốc Bảo",
          "18/07/1998",
          "Nam",
          "030097005678",
          "09/09/2020",
          "Ninh Bình",
          "0985556677",
          "Đỗ Tuấn Anh",
          "Có xe đón",
          "20/11/2025",
          "22/11/2025",
          "Đã đào tạo",
          "23/11/2025",
          "T11.2025",
          "Trực tiếp",
        ],
        // 6. Người đã nghỉ việc - Lý do: Bỏ vì sức khỏe
        [
          6,
          "Amphenol",
          "Thời vụ",
          "Đã nghỉ việc",
          "15/12/2025",
          "Bỏ vì sức khỏe",
          "004102",
          "Đinh Văn Hoàng",
          "02/02/1996",
          "Nam",
          "035096004102",
          "18/01/2021",
          "Hà Nam",
          "0976667788",
          "Nguyễn Thu Trang",
          "Tự túc",
          "01/11/2025",
          "03/11/2025",
          "Đã đào tạo",
          "04/11/2025",
          "T11.2025",
          "Tuyển dụng trực tiếp",
        ],
        // 7. Người mới đạt phỏng vấn
        [
          7,
          "LG",
          "Thời vụ",
          "Đạt phỏng vấn",
          "",
          "",
          "",
          "Nguyễn Minh Quân",
          "30/12/2002",
          "Nam",
          "031202008910",
          "05/06/2023",
          "Hải Phòng",
          "0937778899",
          "Hoàng Văn Hưng",
          "Tự túc",
          "25/12/2025",
          "",
          "Chưa đào tạo",
          "",
          "T12.2025",
          "Fanpage",
        ],
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(sampleRows),
        "DS_TONG",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(sampleRowsThangCu),
        "Tháng cũ",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ["CCCD", "Họ và tên", "SĐT", "Nhà máy", "Lý do cảnh báo"],
        ]),
        "Cảnh báo trùng lặp",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([["Mục", "Liên kết"]]),
        "Link",
      );

      return new NextResponse(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
        {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition":
              'attachment; filename="Mau_DS_TONG_Chuan_2026.xlsx"',
          },
        },
      );
    }

    // 4. Mẫu Form DS_THUONG chuẩn 100% khớp các cột của người dùng
    if (type === "TEMPLATE_DS_THUONG") {
      const headers = [
        "STT",
        "Công ty",
        "Tháng",
        "Ngày PV",
        "Chính sách",
        "Mã nhân viên",
        "Họ tên",
        "Số CCCD",
        "STK",
        "Ngân hàng",
        "Thưởng lần 1",
        "Thưởng lần 2",
        "Thưởng lần 3",
        "Thưởng lần 4",
        "Thưởng lần 5",
        "Thưởng lần 6",
        "Thưởng lần 7",
        "Tổng thưởng",
      ];

      const sampleRows = [
        headers,
        [
          1,
          "Luxshare QC",
          "T01.2026",
          "05/01/2026",
          "Chính sách Mùa Vụ 2026",
          "005014",
          "Nguyễn Văn A",
          "038096001234",
          "1012345678",
          "Vietcombank",
          300000,
          500000,
          500000,
          0,
          0,
          0,
          0,
          1300000,
        ],
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(sampleRows),
        "DS_THUONG",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([headers]),
        "T01_2026",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([headers]),
        "T02_2026",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([headers]),
        "T03_2026",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([["Mục", "Liên kết"]]),
        "Link",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ["Mã NV", "Họ tên", "Công ty", "Tổng thưởng", "Trạng thái chi trả"],
        ]),
        "Theo dõi thưởng",
      );

      return new NextResponse(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
        {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition":
              'attachment; filename="Mau_DS_THUONG_Chuan_2026.xlsx"',
          },
        },
      );
    }

    // 5. Mẫu Form STK Ngân Hàng chuẩn 100% khớp các cột của người dùng
    if (type === "TEMPLATE_STK") {
      const headers = [
        "STT",
        "Công ty",
        "TT",
        "Kết Quả PV",
        "Họ và tên",
        "Ngày sinh",
        "SĐT",
        "CMT/CCCD",
        "Ngày PV",
        "Tuyển Dụng",
        "Tình trạng STK",
        "Cảnh báo",
        "STK",
        "Tên chủ tài khoản",
        "Người check",
        "Kết Quả",
      ];

      const sampleRows = [
        headers,
        [
          1,
          "Luxshare QC",
          "Đã nạp",
          "Đạt PV",
          "Nguyễn Văn A",
          "15/05/2000",
          "0987654321",
          "038096001234",
          "05/01/2026",
          "Đỗ Tuấn Anh",
          "Hợp lệ",
          "",
          "1012345678",
          "NGUYEN VAN A",
          "Kế toán Thu Phương",
          "Khớp tên 100%",
        ],
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(sampleRows),
        "STK ngân hàng 2026",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([headers]),
        "T09.2026",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([headers]),
        "T10.2026",
      );

      return new NextResponse(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
        {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition":
              'attachment; filename="Mau_STK_NganHang_Chuan_2026.xlsx"',
          },
        },
      );
    }

    // 6. Xuất dữ liệu hồ sơ thực tế (DS_TONG & Tháng cũ), chỉ dùng nhà máy PV.
    if (type === "WORKERS") {
      const currentWorkers = await prisma.worker.findMany({
        where: { archivedAt: null },
        include: {
          assignments: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
          },
        },
      });

      const archivedWorkers = await prisma.worker.findMany({
        where: { archivedAt: { not: null } },
        include: {
          assignments: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
          },
        },
      });

      const mapWorkerToRow = (w: any, idx: number) => {
        const a = w.assignments[0];
        return {
          STT: idx + 1,
          "Nhà máy PV": a?.interviewFactory || "",
          "Loại HD": a?.contractType || "Thời vụ",
          "Tình trạng": a?.status || "Đang làm việc",
          "Ngày NH": a?.leaveDate || "",
          "Lý do": a?.leaveReason || "",
          "Mã NV": w.code || "",
          "Họ và tên": w.fullName,
          "Ngày sinh": w.dob || "",
          "Giới tính": w.gender || "",
          "số CCCD": w.idCard,
          "Ngày cấp": w.idCardDate || "",
          "Địa chỉ": w.address || "",
          SĐT: w.phone || "",
          "Tuyển dụng": a?.recruiter || w.recruiter || "",
          "Đón xe - KTX": a?.shuttleBusKtx || "Tự túc",
          "Ngày PV": a?.interviewDate || "",
          "Ngày Đào tạo dự kiến": a?.expectedTrainingDate || "",
          "Tình trạng Đào tạo dự kiến": a?.expectedTrainingStatus || "",
          "Ngày đào tạo chuẩn":
            a?.standardTrainingDate || a?.interviewDate || "",
          "Tháng nhận việc": a?.onboardingMonth || "",
          Nguồn: a?.source || w.source || "Trực tiếp",
        };
      };

      const currentRows = currentWorkers.map(mapWorkerToRow);
      const archivedRows = archivedWorkers.map(mapWorkerToRow);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(currentRows),
        "DS_TONG",
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(archivedRows),
        "Tháng cũ",
      );

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      return new NextResponse(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="DS_TONG_Export.xlsx"`,
        },
      });
    }

    return NextResponse.json(
      { success: false, message: "Loại xuất không hợp lệ" },
      { status: 400 },
    );
  } catch {
    return NextResponse.json(
      { success: false, message: "Không thể xử lý yêu cầu lúc này" },
      { status: 500 },
    );
  }
}
