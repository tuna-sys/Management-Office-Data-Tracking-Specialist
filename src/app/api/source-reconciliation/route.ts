import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, identity } from "@/lib/local-request";
import { readImportSources } from "@/lib/import-source-store";
import { sourceLinkDecision, linkSourceBonus } from "@/lib/source-assignment-link";
import { normalizeCccd } from "@/lib/worker-validation";
import { cachedRead } from "@/lib/read-cache";
import { readDataVersion } from "@/lib/read-data-version";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const p = request.nextUrl.searchParams;
    const version = await readDataVersion();
    const rows = await cachedRead("source-reconciliation", version, async () => {
      const [sources, workers] = await Promise.all([readImportSources(), prisma.worker.findMany({
        select: { id: true, idCard: true, fullName: true, updatedAt: true, assignments: true },
      })]);
      const byCard = new Map(workers.map(w => [normalizeCccd(w.idCard), w]));
      return sources.filter(s => ["DS_TONG", "DS_THUONG"].includes(s.type)).flatMap(source => (source.rows || []).map((row: any) => {
        const raw = row.values || {};
        const card = normalizeCccd(raw["Số CCCD"] || raw["số CCCD"] || raw.CCCD || "");
        const worker = byCard.get(card);
        return { sourceId: source.id, row: row.row, type: source.type, file: source.file, fullName: raw["Họ tên"] || raw["Họ và tên"] || "",
          company: raw["Công ty"] || raw["Nhà máy PV"] || "", interviewDate: raw["Ngày PV"] || "", workerId: worker?.id || null,
          ...sourceLinkDecision(worker, source, row) };
      }));
    });
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.state] = (counts[row.state] || 0) + 1;
    const filtered = rows.filter(row => (!p.get("sourceId") || row.sourceId === p.get("sourceId")) && (!p.get("state") || row.state === p.get("state")));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(p.get("pageSize")) || 10)));
    const page = Math.min(Math.max(1, Math.floor(Number(p.get("page")) || 1)), Math.max(1, Math.ceil(filtered.length / pageSize)));
    return NextResponse.json({ success: true, data: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, counts, page, pageSize });
  } catch { return NextResponse.json({ success: false, message: "Không đọc được kết quả đối chiếu nguồn" }, { status: 500 }); }
}
export async function POST(request: NextRequest) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const body = await request.json();
    if (body.confirm !== true || body.action !== "LINK_BONUSES" || !Array.isArray(body.items) || !body.items.length || body.items.length > 100)
      return NextResponse.json({ success: false, message: "Cần chọn từ 1 đến 100 dòng và xác nhận liên kết" }, { status: 400 });
    const actor = (await identity(request))!;
    const sources = await readImportSources();
    const result = await prisma.$transaction(async tx => {
      const results = [];
      for (const input of body.items) {
        const source = sources.find(s => s.id === input.sourceId);
        const row = source?.rows?.find((r: any) => r.row === Number(input.row));
        if (!source || !row) throw Object.assign(new Error("Dòng nguồn đã thay đổi hoặc không còn; tải lại để đối chiếu"), { status: 409 });
        results.push(await linkSourceBonus(tx, source, row, input, actor.username));
      }
      return results;
    }, { timeout: 60000 });
    return NextResponse.json({ success: true, data: result, linkedCount: result.filter(r => r.linked).length });
  } catch (error: any) { return NextResponse.json({ success: false, message: error?.message || "Không thể liên kết nguồn với lượt tuyển" }, { status: error?.status || 400 }); }
}
