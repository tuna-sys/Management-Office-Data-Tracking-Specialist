import { guard, identity } from "@/lib/local-request";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { provinceName } from "@/lib/province-name";
export const dynamic = "force-dynamic";
const FACTORIES = [
  "Luxshare QC",
  "Canon",
  "Goertek",
  "Fushan",
  "Amphenol",
  "Bảo vệ",
  "Foxconn",
  "Luxshare VT",
  "LG",
];
export async function GET(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const workers = await prisma.worker.findMany({
      include: {
        assignments: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    const bonuses = await prisma.bonusRecord.findMany();
    const bankAccounts = await prisma.bankAccount.findMany();
    // 1. Thống kê tổng quan
    const totalWorkers = workers.length;
    let workingCount = 0;
    let resignedCount = 0;
    let passedCount = 0;
    let waitingCount = 0;
    // 2. Ma trận Nhà máy x Trạng thái
    const matrix: Record<
      string,
      {
        working: number;
        resigned: number;
        passed: number;
        waiting: number;
        total: number;
      }
    > = {};
    for (const f of FACTORIES) {
      matrix[f] = { working: 0, resigned: 0, passed: 0, waiting: 0, total: 0 };
    }
    // 3. Phân bổ theo Recruiter
    const recruiterMap: Record<
      string,
      {
        total: number;
        working: number;
      }
    > = {};
    // 4. Phân bổ theo tỉnh thành
    const provinceMap: Record<string, number> = {};
    for (const w of workers) {
      const a = w.assignments[0];
      const factory = a?.interviewFactory || "Khác";
      const status = a?.status || "Chưa rõ";
      if (!matrix[factory]) {
        matrix[factory] = {
          working: 0,
          resigned: 0,
          passed: 0,
          waiting: 0,
          total: 0,
        };
      }
      matrix[factory].total++;
      if (status === "Đang làm việc") {
        workingCount++;
        matrix[factory].working++;
      } else if (status === "Đã nghỉ việc") {
        resignedCount++;
        matrix[factory].resigned++;
      } else if (status === "Đạt phỏng vấn") {
        passedCount++;
        matrix[factory].passed++;
      } else {
        waitingCount++;
        matrix[factory].waiting++;
      }
      // Recruiter KPI
      const rec = a?.recruiter || w.recruiter || "Chưa gán";
      if (!recruiterMap[rec]) recruiterMap[rec] = { total: 0, working: 0 };
      recruiterMap[rec].total++;
      if (status === "Đang làm việc") recruiterMap[rec].working++;
      // Tỉnh thành
      const prov =
        provinceName(w.province, w.address) || "Chưa ghi nhận";
      provinceMap[prov] = (provinceMap[prov] || 0) + 1;
    }
    // Tổng tiền thưởng
    const totalBonusAmount = bonuses
      .filter((b) => ["APPROVED", "LOCKED"].includes(b.status))
      .reduce((sum, b) => sum + (b.totalBonus || 0), 0);
    const approvedBonusCount = bonuses.filter(
      (b) => b.status === "APPROVED" || b.status === "LOCKED",
    ).length;
    // Cảnh báo ngân hàng
    const bankMismatches = bankAccounts.filter(
      (b) => b.verificationStatus === "MISMATCH",
    ).length;
    // Retention rate
    const retentionRate =
      totalWorkers > 0 ? Math.round((workingCount / totalWorkers) * 100) : 0;
    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalWorkers,
          workingCount,
          resignedCount,
          passedCount,
          waitingCount,
          retentionRate,
          totalBonusAmount,
          approvedBonusCount,
          bankMismatches,
        },
        matrix: Object.entries(matrix).map(([factory, counts]) => ({
          factory,
          ...counts,
          retention:
            counts.total > 0
              ? Math.round((counts.working / counts.total) * 100)
              : 0,
        })),
        recruiters: Object.entries(recruiterMap).map(([name, data]) => ({
          name,
          total: data.total,
          working: data.working,
          retention:
            data.total > 0 ? Math.round((data.working / data.total) * 100) : 0,
        })),
        provinces: Object.entries(provinceMap).map(([province, count]) => ({
          province,
          count,
        })),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: "Không thể xử lý yêu cầu lúc này" },
      { status: 500 },
    );
  }
}
