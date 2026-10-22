import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { POST as importRoutePOST } from "@/app/api/excel-engine/import/route";

export interface GoogleSheetSource {
  id: string;
  name: string;
  url: string;
  spreadsheetId: string;
  smartMerge: boolean;
  importType: string;
  lastHash?: string;
  lastSyncAt?: string;
  lastStatus: "IDLE" | "SYNCING" | "SUCCESS" | "NO_CHANGE" | "FAILED";
  lastMessage?: string;
  lastSummary?: {
    totalRows?: number;
    successCount?: number;
    mergedCount?: number;
    duplicateCount?: number;
    newWorkerCount?: number;
  };
  lastError?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface GoogleSyncConfig {
  autoSyncEnabled: boolean;
  syncIntervalSeconds: number; // default 60
  activeSourceId: string;
  sources: GoogleSheetSource[];
}

const CONFIG_FILE_PATH = path.join(process.cwd(), "data", "google-sync-config.json");

export function extractSpreadsheetId(url: string): string | null {
  if (!url) return null;
  const match = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

export async function getGoogleSyncConfig(): Promise<GoogleSyncConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.sources)) data.sources = [];
    if (typeof data.autoSyncEnabled !== "boolean") data.autoSyncEnabled = false;
    if (typeof data.syncIntervalSeconds !== "number") data.syncIntervalSeconds = 60;
    return data;
  } catch {
    // Default fallback configuration
    const defaultConfig: GoogleSyncConfig = {
      autoSyncEnabled: false,
      syncIntervalSeconds: 60,
      activeSourceId: "",
      sources: [],
    };
    return defaultConfig;
  }
}

export async function saveGoogleSyncConfig(cfg: GoogleSyncConfig): Promise<void> {
  const dir = path.dirname(CONFIG_FILE_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

/**
 * Kiểm tra thay đổi khi bật quét ngầm (tùy chọn).
 * Đồng bộ ngay (~100.000 dòng) bỏ qua bước này để không tải CSV rồi mới tải xlsx.
 */
export async function checkGoogleSheetChange(
  spreadsheetId: string,
  lastHash?: string,
): Promise<{ changed: boolean; newHash: string; status: number }> {
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;
  
  const res = await fetch(gvizUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Cache-Control": "no-cache",
    },
    // Chờ tối đa 15 giây
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Google Sheets phản hồi mã lỗi ${res.status}. Vui lòng kiểm tra quyền chia sẻ công khai.`);
  }

  const csvText = await res.text();
  const newHash = crypto.createHash("md5").update(csvText).digest("hex");
  const changed = !lastHash || newHash !== lastHash;

  return { changed, newHash, status: res.status };
}

/**
 * Thực thi đồng bộ Google Sheet
 * @param sourceId ID nguồn cần đồng bộ
 * @param force Nếu true, bỏ qua kiểm tra hash và bắt buộc import lại
 */
export async function executeGoogleSync(
  sourceId?: string,
  force = false,
): Promise<{
  success: boolean;
  changed: boolean;
  message: string;
  summary?: any;
  error?: string;
}> {
  const cfg = await getGoogleSyncConfig();
  const targetId = sourceId || cfg.activeSourceId;
  const source = cfg.sources.find((s) => s.id === targetId) || cfg.sources[0];

  if (!source || !source.url) {
    return {
      success: false,
      changed: false,
      message: "Chưa cấu hình đường link Google Sheets nào để đồng bộ.",
    };
  }

  const spreadsheetId = extractSpreadsheetId(source.url);
  if (!spreadsheetId) {
    return {
      success: false,
      changed: false,
      message: "Đường link Google Sheets không đúng định dạng.",
    };
  }

  // Cập nhật trạng thái đang đồng bộ
  source.lastStatus = "SYNCING";
  source.lastMessage = force
    ? "Đang tải và nạp dữ liệu (bộ lớn có thể mất vài phút)..."
    : "Đang kiểm tra và đồng bộ...";
  await saveGoogleSyncConfig(cfg);

  try {
    // BƯỚC 1: Hash CSV chỉ khi quét ngầm. Đồng bộ ngay (force) tải thẳng xlsx.
    let isChanged = true;
    let newHash = "";

    if (!force) {
      try {
        const checkResult = await checkGoogleSheetChange(spreadsheetId, source.lastHash);
        isChanged = checkResult.changed;
        newHash = checkResult.newHash;
      } catch (checkErr: any) {
        console.warn("[GoogleSync] Lỗi kiểm tra GViz hash, sẽ chuyển sang tải trực tiếp:", checkErr?.message);
        isChanged = true;
      }

      if (!isChanged && source.lastHash) {
        source.lastStatus = "NO_CHANGE";
        source.lastSyncAt = new Date().toISOString();
        source.lastMessage = "Đã quét ngầm: Bảng tính không có thay đổi mới.";
        await saveGoogleSyncConfig(cfg);
        return {
          success: true,
          changed: false,
          message: "Bảng tính không có thay đổi mới.",
          summary: source.lastSummary,
        };
      }
    }

    // BƯỚC 2: Có thay đổi hoặc ép buộc đồng bộ -> Nạp dữ liệu vào hệ thống
    const formData = new FormData();
    formData.append("googleSheetUrl", source.url);
    formData.append("confirm", "true");
    formData.append("smartMerge", source.smartMerge !== false ? "true" : "false");
    formData.append("importType", source.importType || "AUTO");

    const internalReq = new NextRequest("http://localhost:3000/api/excel-engine/import", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
      },
      body: formData,
    });

    const importRes = await importRoutePOST(internalReq);
    const result = await importRes.json();

    if (!result.success) {
      throw new Error(result.message || "Lỗi nạp dữ liệu từ Google Sheets");
    }

    // BƯỚC 3: Cập nhật cấu hình thành công
    source.lastStatus = "SUCCESS";
    source.lastHash = newHash || source.lastHash;
    source.lastSyncAt = new Date().toISOString();
    source.lastError = undefined;
    source.lastSummary = {
      totalRows: result.summary?.totalRows || 0,
      successCount: result.summary?.readyCount || result.summary?.successCount || 0,
      mergedCount: result.summary?.mergedCount || 0,
      duplicateCount: result.summary?.duplicateCount || 0,
      newWorkerCount: result.summary?.newWorkerCount || 0,
    };
    source.lastMessage = `Đồng bộ thành công ${source.lastSummary.successCount.toLocaleString("vi-VN")} dòng (bổ sung ${source.lastSummary.mergedCount.toLocaleString("vi-VN")} dòng).`;

    await saveGoogleSyncConfig(cfg);

    return {
      success: true,
      changed: true,
      message: source.lastMessage,
      summary: source.lastSummary,
    };
  } catch (err: any) {
    const errMsg = err?.message || "Lỗi không xác định khi đồng bộ";
    source.lastStatus = "FAILED";
    source.lastError = errMsg;
    source.lastMessage = `Đồng bộ thất bại: ${errMsg}`;
    source.lastSyncAt = new Date().toISOString();
    await saveGoogleSyncConfig(cfg);

    return {
      success: false,
      changed: false,
      message: source.lastMessage,
      error: errMsg,
    };
  }
}
