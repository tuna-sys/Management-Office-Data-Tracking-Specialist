import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/local-request";
import { POST as previewImport } from "@/app/api/excel-engine/import/route";
import {
  getGoogleSyncConfig,
  saveGoogleSyncConfig,
  extractSpreadsheetId,
} from "@/lib/google-sync-engine";

export const maxDuration = 600;

export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    const config = await getGoogleSyncConfig();
    const activeSource = config.sources.find((s) => s.id === config.activeSourceId) || config.sources[0] || null;
    return NextResponse.json({
      success: true,
      config,
      activeSource,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Lỗi lấy cấu hình Google Sync" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const action = body.action || "sync-now";

    const config = await getGoogleSyncConfig();

    // 1. Thêm hoặc cập nhật nguồn Google Sheet
    if (action === "save-source") {
      const { id, name, url, smartMerge, importType, autoSync } = body;
      const cleanUrl = String(url || "").trim();

      if (!cleanUrl) {
        return NextResponse.json(
          { success: false, message: "Vui lòng nhập đường link Google Sheets" },
          { status: 400 },
        );
      }

      const spreadsheetId = extractSpreadsheetId(cleanUrl);
      if (!spreadsheetId) {
        return NextResponse.json(
          {
            success: false,
            message: "Đường link không hợp lệ. Vui lòng copy link Google Sheets dạng https://docs.google.com/spreadsheets/d/...",
          },
          { status: 400 },
        );
      }

      let source = config.sources.find((s) => s.id === id || s.spreadsheetId === spreadsheetId);
      const isNew = !source;

      if (!source) {
        source = {
          id: id || `gs-${Date.now()}`,
          name: name?.trim() || `Bảng tính ${spreadsheetId.substring(0, 8)}`,
          url: cleanUrl,
          spreadsheetId,
          smartMerge: smartMerge !== false,
          importType: importType || "AUTO",
          lastStatus: "IDLE",
          lastMessage: "Chưa đồng bộ",
          createdAt: new Date().toISOString(),
        };
        config.sources.unshift(source);
      } else {
        if (name?.trim()) source.name = name.trim();
        source.url = cleanUrl;
        source.spreadsheetId = spreadsheetId;
        source.smartMerge = smartMerge !== false;
        source.importType = importType || source.importType || "AUTO";
        source.updatedAt = new Date().toISOString();
      }

      // Đặt làm nguồn kích hoạt
      config.activeSourceId = source.id;
      config.autoSyncEnabled = false;

      await saveGoogleSyncConfig(config);

      return NextResponse.json({
        success: true,
        message: isNew ? "Đã lưu nguồn Google Sheets mới!" : "Đã cập nhật nguồn Google Sheets!",
        source,
        config,
      });
    }

    // 2. Chuyển đổi nguồn kích hoạt
    if (action === "set-active") {
      const { sourceId } = body;
      const exists = config.sources.some((s) => s.id === sourceId);
      if (!exists) {
        return NextResponse.json({ success: false, message: "Không tìm thấy nguồn chỉ định" }, { status: 404 });
      }
      config.activeSourceId = sourceId;
      await saveGoogleSyncConfig(config);
      return NextResponse.json({ success: true, message: "Đã chọn nguồn kích hoạt", config });
    }

    // 3. Xóa nguồn Google Sheet
    if (action === "delete-source") {
      const { sourceId } = body;
      config.sources = config.sources.filter((s) => s.id !== sourceId);
      if (config.activeSourceId === sourceId) {
        config.activeSourceId = config.sources[0]?.id || "";
      }
      await saveGoogleSyncConfig(config);
      return NextResponse.json({ success: true, message: "Đã xóa nguồn Google Sheets", config });
    }

    // 4. Bật / Tắt tự động quét
    if (action === "toggle-auto") {
      const { enabled, intervalSeconds } = body;
      config.autoSyncEnabled = false;
      if (typeof intervalSeconds === "number" && intervalSeconds >= 10) {
        config.syncIntervalSeconds = intervalSeconds;
      }
      await saveGoogleSyncConfig(config);
      return NextResponse.json({
        success: true,
        message: config.autoSyncEnabled
          ? `Đã bật tự động quét mỗi ${config.syncIntervalSeconds} giây`
          : "Đã tắt tự động quét",
        config,
      });
    }

    // Manual reading never confirms an import or writes source snapshots.
    if (action === "sync-now" || action === "preview" || action === "commit") {
      const source = config.sources.find((s) => s.id === (body.sourceId || config.activeSourceId)) || config.sources[0];
      const url = String(body.googleSheetUrl || source?.url || "").trim();
      if (!extractSpreadsheetId(url)) return NextResponse.json({ success: false, message: "Nhập link Google Sheets hợp lệ để đọc." }, { status: 400 });
      const committing = action === "commit";
      if (committing && body.confirm !== true) return NextResponse.json({ success: false, message: "Cần xác nhận trước khi ghi bản ghi." }, { status: 400 });
      const form = new FormData();
      form.append("googleSheetUrl", url);
      form.append("confirm", committing ? "true" : "false");
      if (body.previewFingerprint) form.append("previewFingerprint", body.previewFingerprint);
      form.append("smartMerge", (body.smartMerge ?? source?.smartMerge) === false ? "false" : "true");
      form.append("importType", body.importType || source?.importType || "AUTO");
      const target = new URL("/api/excel-engine/import", req.url);
      const response = await previewImport(new NextRequest(target, {
        method: "POST",
        headers: { host: target.host, origin: target.origin },
        body: form,
      }));
      const result = await response.json();
      return NextResponse.json({ ...result, changed: committing && result.success, config, previewSource: { googleSheetUrl: url, importType: body.importType || source?.importType || "AUTO", smartMerge: (body.smartMerge ?? source?.smartMerge) !== false, previewFingerprint: result.previewFingerprint }, message: result.success ? (committing ? `Đã ghi ${result.normalizedSaved || 0} bản ghi nghiệp vụ.` : "Đã quét xong; xem kết quả rồi xác nhận ghi bản ghi.") : result.message }, { status: response.status });
    }
    if (action === "poll-auto-sync") {
      return NextResponse.json({ success: false, message: "Tự động đồng bộ đã tắt. Bấm Đồng bộ để đọc thủ công." }, { status: 400 });
    }

    return NextResponse.json({ success: false, message: "Action không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Lỗi xử lý yêu cầu Google Sync" },
      { status: 500 },
    );
  }
}
