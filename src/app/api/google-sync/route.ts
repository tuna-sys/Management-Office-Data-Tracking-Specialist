import { NextRequest, NextResponse } from "next/server";
import {
  getGoogleSyncConfig,
  saveGoogleSyncConfig,
  executeGoogleSync,
  extractSpreadsheetId,
  GoogleSheetSource,
} from "@/lib/google-sync-engine";

export async function GET() {
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
      if (typeof autoSync === "boolean") {
        config.autoSyncEnabled = autoSync;
      }

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
      if (typeof enabled === "boolean") config.autoSyncEnabled = enabled;
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

    // 5. Đồng bộ ngay (Sync now - ép buộc đồng bộ kể cả khi chưa đổi hash hoặc kiểm tra hash)
    if (action === "sync-now") {
      const { sourceId, force } = body;
      const result = await executeGoogleSync(sourceId, force !== false);
      const updatedConfig = await getGoogleSyncConfig();
      return NextResponse.json({
        ...result,
        config: updatedConfig,
      });
    }

    // 6. Quét ngầm định kỳ (Auto poll - kiểm tra hash trước, chỉ nạp khi có đổi)
    if (action === "poll-auto-sync") {
      const { sourceId } = body;
      const result = await executeGoogleSync(sourceId, false);
      const updatedConfig = await getGoogleSyncConfig();
      return NextResponse.json({
        ...result,
        config: updatedConfig,
      });
    }

    return NextResponse.json({ success: false, message: "Action không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Lỗi xử lý yêu cầu Google Sync" },
      { status: 500 },
    );
  }
}
