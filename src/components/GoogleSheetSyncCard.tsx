"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Card,
  Input,
  Button,
  Switch,
  Tag,
  Alert,
  message,
  Popconfirm,
  Badge,
  Tooltip,
  Select,
  Dropdown,
} from "antd";
import {
  Globe,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Link2,
  Trash2,
  Layers,
  ChevronRight,
  ShieldCheck,
  Check,
} from "lucide-react";

interface GoogleSheetSource {
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
}

interface GoogleSyncConfig {
  autoSyncEnabled: boolean;
  syncIntervalSeconds: number;
  activeSourceId: string;
  sources: GoogleSheetSource[];
}

interface Props {
  onSyncCompleted?: (summary?: any) => void;
}

export default function GoogleSheetSyncCard({ onSyncCompleted }: Props) {
  const [config, setConfig] = useState<GoogleSyncConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [importType, setImportType] = useState("AUTO");
  const [smartMerge, setSmartMerge] = useState(true);
  const [editing, setEditing] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/google-sync");
      const data = await res.json();
      if (data.success && data.config) {
        setConfig(data.config);
        const active = data.config.sources.find(
          (s: any) => s.id === data.config.activeSourceId,
        ) || data.config.sources[0];
        if (active) {
          setNewUrl(active.url || "");
          setNewName(active.name || "");
          setImportType(active.importType || "AUTO");
          setSmartMerge(active.smartMerge !== false);
        }
      }
    } catch {
      // ignore initial error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  // Đếm ngược và tự động quét ngầm mỗi chu kỳ (mặc định 60s)
  useEffect(() => {
    if (!config?.autoSyncEnabled || !config?.activeSourceId) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const intervalSec = config.syncIntervalSeconds || 60;
    setSecondsLeft(intervalSec);

    timerRef.current = setInterval(async () => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          // Kích hoạt quét ngầm
          triggerPollSync();
          return intervalSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [config?.autoSyncEnabled, config?.activeSourceId, config?.syncIntervalSeconds]);

  // Quét ngầm nhẹ nhàng (chỉ kiểm tra hash, nếu có đổi mới nạp dữ liệu)
  const triggerPollSync = async () => {
    if (syncing) return;
    try {
      const res = await fetch("/api/google-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "poll-auto-sync",
          sourceId: config?.activeSourceId,
        }),
      });
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
      }
      if (data.success && data.changed) {
        message.success(
          `Google Sheets: Đã tự động cập nhật ${data.summary?.totalRows || ""} dòng dữ liệu mới!`,
        );
        if (onSyncCompleted) onSyncCompleted(data.summary);
      }
    } catch {
      // background poll error is silent
    }
  };

  // Lưu nguồn Google Sheet
  const handleSaveSource = async (syncImmediately = false) => {
    const url = newUrl.trim();
    if (!url) {
      message.warning("Vui lòng dán đường link Google Sheets vào ô");
      return;
    }

    setSyncing(true);
    try {
      const res = await fetch("/api/google-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-source",
          url,
          name: newName.trim(),
          importType,
          smartMerge,
          autoSync: config?.autoSyncEnabled ?? true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig(data.config);
        message.success(data.message);
        setEditing(false);
        if (syncImmediately) {
          await handleSyncNow(data.source?.id || config?.activeSourceId);
        }
      } else {
        message.error(data.message || "Lỗi lưu liên kết Google Sheets");
      }
    } catch {
      message.error("Lỗi kết nối khi lưu đường link");
    } finally {
      setSyncing(false);
    }
  };

  // Bấm nút "Đồng bộ ngay" (ép kiểm tra và nạp ngay)
  const handleSyncNow = async (sourceId?: string) => {
    setSyncing(true);
    const targetId = sourceId || config?.activeSourceId;
    try {
      const res = await fetch("/api/google-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync-now",
          sourceId: targetId,
          force: true,
        }),
      });
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
      }
      if (data.success) {
        message.success(data.message || "Đồng bộ thành công!");
        if (onSyncCompleted) onSyncCompleted(data.summary);
      } else {
        message.error(data.message || "Đồng bộ thất bại");
      }
    } catch {
      message.error("Lỗi kết nối khi đồng bộ");
    } finally {
      setSyncing(false);
      setSecondsLeft(config?.syncIntervalSeconds || 60);
    }
  };

  // Chuyển đổi trạng thái tự động quét 1 phút
  const handleToggleAuto = async (checked: boolean) => {
    try {
      const res = await fetch("/api/google-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle-auto",
          enabled: checked,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig(data.config);
        message.info(data.message);
      }
    } catch {
      message.error("Không thể thay đổi trạng thái tự động quét");
    }
  };

  // Xóa nguồn Google Sheet
  const handleDeleteSource = async (sourceId: string) => {
    try {
      const res = await fetch("/api/google-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete-source",
          sourceId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig(data.config);
        message.success("Đã gỡ liên kết; dữ liệu đã nhập được giữ nguyên");
        await fetchConfig();
      }
    } catch {
      message.error("Lỗi khi xóa nguồn");
    }
  };

  const activeSource =
    config?.sources.find((s) => s.id === config?.activeSourceId) ||
    config?.sources[0];

  return (
    <Card
      className="border-slate-200 shadow-md rounded-2xl overflow-hidden mb-6"
      title={
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-slate-800 text-sm sm:text-base">
                Nguồn Google Sheets
              </span>
              <div className="text-[11px] text-slate-500 font-normal">
                Quản lý nguồn và theo dõi kết quả đồng bộ
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 font-medium">Tự động quét ngầm (60s):</span>
            <Switch
              checked={config?.autoSyncEnabled ?? true}
              onChange={handleToggleAuto}
              checkedChildren="BẬT"
              unCheckedChildren="TẮT"
              className="bg-slate-300"
            />
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Banner hướng dẫn nhanh */}
        <div className="flex justify-end"><Button onClick={() => { setNewUrl(""); setNewName(""); setImportType("AUTO"); setSmartMerge(true); setEditing(true); }} disabled={syncing}>Thêm nguồn</Button></div>
        {(editing || !config?.sources.length) && <>
        {/* Ô nhập liên kết Google Sheets */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
          <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
            <span>Dán đường link Google Sheets của bạn:</span>
            {config?.autoSyncEnabled && activeSource?.url && (
              <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 animate-pulse" />
                Lần quét tự động tiếp theo: {secondsLeft}s
              </span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              disabled={syncing}
              size="large"
              allowClear
              className="rounded-lg flex-1"
            />
            <Button
              type="primary"
              size="large"
              loading={syncing}
              onClick={() => handleSaveSource(false)}
              className="bg-emerald-600 hover:bg-emerald-500 font-bold shrink-0 shadow-sm"
              icon={<RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />}
            >
              Lưu nguồn
            </Button>
          </div>

          <Button type="text" onClick={() => setEditing(false)} disabled={syncing}>Hủy</Button>
          <details><summary className="cursor-pointer text-xs text-slate-600">Tùy chọn nâng cao</summary>
          {/* Tùy chỉnh tên và chế độ */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <Input
              placeholder="Tên gợi nhớ (Ví dụ: Sheet Tổng Hợp Tháng 10)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              size="small"
              className="rounded-md"
            />
            <Select
              size="small"
              value={importType}
              onChange={setImportType}
              className="w-full"
              options={[
                { label: "✨ Tự động nhận diện (DS Tổng + Thưởng)", value: "AUTO" },
                { label: "👥 Chỉ nạp Hồ sơ lao động (DS_TONG)", value: "DS_TONG" },
                { label: "💰 Chỉ nạp Quản lý Thưởng (DS_THUONG)", value: "DS_THUONG" },
              ]}
            />
            <div className="flex items-center gap-2 px-2 py-1 bg-white border border-slate-200 rounded-md text-xs">
              <Switch
                size="small"
                checked={smartMerge}
                onChange={setSmartMerge}
              />
              <span className="text-slate-600 text-[11px]">
                Smart Merge: Tự điền ô còn trống
              </span>
            </div>
          </div>
          </details>
        </div>
        </>}
        {/* Trạng thái hoạt động hiện tại */}
        {activeSource && activeSource.url && (
          <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge
                  status={
                    activeSource.lastStatus === "SYNCING"
                      ? "processing"
                      : activeSource.lastStatus === "SUCCESS"
                        ? "success"
                        : activeSource.lastStatus === "NO_CHANGE"
                          ? "default"
                          : "error"
                  }
                />
                <span className="font-bold text-slate-800 text-xs">
                  {activeSource.name || "Bảng tính hiện tại"}
                </span>
                <Tag color={activeSource.lastStatus === "SUCCESS" ? "green" : "blue"} className="text-[10px] m-0">
                  {activeSource.lastStatus === "SYNCING"
                    ? "Đang đồng bộ..."
                    : activeSource.lastStatus === "SUCCESS"
                      ? "Đã đồng bộ thành công"
                      : activeSource.lastStatus === "NO_CHANGE"
                        ? "Đã quét: Không có thay đổi mới"
                        : "Sẵn sàng"}
                </Tag>
              </div>

              <div className="flex items-center gap-2">
                <Dropdown menu={{ items: [
                  { key: "edit", label: "Sửa cấu hình", onClick: () => { setNewUrl(activeSource.url); setNewName(activeSource.name); setImportType(activeSource.importType); setSmartMerge(activeSource.smartMerge); setEditing(true); } },
                  { key: "clear", label: "Xóa dữ liệu nguồn này (chưa thể xác định an toàn)", disabled: true },
                ] }}><Button size="small" disabled={syncing}>Thao tác</Button></Dropdown>
                <Popconfirm title="Gỡ nguồn đồng bộ?" description="Giữ nguyên dữ liệu đã nhập và nội dung Google Sheets." onConfirm={() => handleDeleteSource(activeSource.id)} okText="Gỡ nguồn" cancelText="Hủy"><Button size="small" danger disabled={syncing}>Gỡ nguồn</Button></Popconfirm>
                <Button
                  size="small"
                  type="default"
                  loading={syncing}
                  onClick={() => handleSyncNow(activeSource.id)}
                  className="font-semibold text-xs border-slate-300 hover:border-emerald-500"
                  icon={<RefreshCw className={`w-3 h-3 text-emerald-600 ${syncing ? "animate-spin" : ""}`} />}
                >
                  Đồng bộ ngay
                </Button>
              </div>
            </div>

            {/* Thông tin dòng và thời gian */}
            <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
              <div className="truncate max-w-[320px] sm:max-w-md">
                <span>Link: </span>
                <a
                  href={activeSource.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {activeSource.url}
                </a>
              </div>
              <div>
                {activeSource.lastSyncAt ? (
                  <span>
                    Lần quét gần nhất:{" "}
                    <b>{new Date(activeSource.lastSyncAt).toLocaleTimeString("vi-VN")}</b> (
                    {new Date(activeSource.lastSyncAt).toLocaleDateString("vi-VN")})
                  </span>
                ) : (
                  <span>Chưa quét lần nào</span>
                )}
              </div>
            </div>

            {/* Kết quả số lượng dòng nạp */}
            {activeSource.lastSummary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-center text-xs">
                <div className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="text-slate-500 text-[10px]">Tổng dòng trên Sheet</div>
                  <div className="font-bold text-slate-800 text-sm">
                    {(activeSource.lastSummary.totalRows || 0).toLocaleString("vi-VN")}
                  </div>
                </div>
                <div className="p-2 bg-emerald-50 rounded-lg border border-emerald-100">
                  <div className="text-emerald-700 text-[10px]">Đã ghi nhận vào CSDL</div>
                  <div className="font-bold text-emerald-700 text-sm">
                    {(activeSource.lastSummary.successCount || 0).toLocaleString("vi-VN")}
                  </div>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg border border-blue-100">
                  <div className="text-blue-700 text-[10px]">Điền bù thông tin trống</div>
                  <div className="font-bold text-blue-700 text-sm">
                    {(activeSource.lastSummary.mergedCount || 0).toLocaleString("vi-VN")}
                  </div>
                </div>
                <div className="p-2 bg-amber-50 rounded-lg border border-amber-100">
                  <div className="text-amber-700 text-[10px]">Dòng tách trùng lặp</div>
                  <div className="font-bold text-amber-700 text-sm">
                    {(activeSource.lastSummary.duplicateCount || 0).toLocaleString("vi-VN")}
                  </div>
                </div>
              </div>
            )}

            {activeSource.lastError && (
              <Alert
                type="error"
                showIcon
                message={activeSource.lastError}
                className="text-xs py-1.5"
              />
            )}
          </div>
        )}

        {activeSource && <p className="text-xs text-slate-500">Xóa dữ liệu theo nguồn đang khóa vì chưa xác định được bản ghi dùng chung giữa các lần nhập.</p>}
        {/* Danh sách các link đã lưu nếu có nhiều hơn 1 nguồn */}
        {config?.sources && config.sources.length > 1 && (
          <div className="pt-2">
            <div className="text-xs font-bold text-slate-700 mb-2">
              Các nguồn Google Sheets khác ({config.sources.length - 1}):
            </div>
            <div className="space-y-1.5">
              {config.sources.filter((s) => s.id !== activeSource?.id).map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center justify-between p-2 rounded-lg border text-xs transition ${
                    s.id === config.activeSourceId
                      ? "bg-blue-50/70 border-blue-300 font-semibold text-blue-900"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {s.id === config.activeSourceId && (
                      <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    )}
                    <span className="truncate">{s.name || s.url}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {s.id !== config.activeSourceId && (
                      <Button
                        size="small"
                        type="link"
                        onClick={async () => {
                          await fetch("/api/google-sync", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              action: "set-active",
                              sourceId: s.id,
                            }),
                          });
                          fetchConfig();
                        }}
                        className="text-xs p-0 text-blue-600"
                      >
                        Kích hoạt
                      </Button>
                    )}
                    <Popconfirm
                      title="Gỡ nguồn này?"
                      description="Giữ nguyên dữ liệu đã nhập."
                      onConfirm={() => handleDeleteSource(s.id)}
                      okText="Gỡ nguồn"
                      cancelText="Hủy"
                    >
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<Trash2 className="w-3 h-3" />}
                        className="p-1"
                      />
                    </Popconfirm>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
