"use client";
import React, { useState, useEffect } from "react";
import {
  Upload,
  Button,
  Card,
  message,
  Alert,
  Table,
  Tag,
  Select,
  Segmented,
  Tabs,
  Popconfirm,
  Collapse,
  Checkbox,
  Modal,
} from "antd";
import {
  FileSpreadsheet,
  UploadCloud,
  Download,
  CheckCircle2,
  Coins,
  CreditCard,
  Users,
  Sparkles,
  Layers,
  Trash2,
} from "lucide-react";
import ImportRecoveryAndLinks from "@/components/ImportRecoveryAndLinks";
import GoogleSheetSyncCard from "@/components/GoogleSheetSyncCard";

const { Dragger } = Upload;

export default function ExcelToolsPage() {
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [profileId, setProfileId] = useState("");
  const [importMode, setImportMode] = useState<string>("AUTO");
  const [inputTab, setInputTab] = useState("GOOGLE_SHEET");
  const [uploading, setUploading] = useState(false);
  const [smartMerge, setSmartMerge] = useState(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingSheet, setPendingSheet] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClearImportedData = async () => {
    setClearing(true);
    try {
      const response = await fetch("/api/excel-engine/clear", { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        message.error(data.message || "Không thể xóa dữ liệu đã nhập");
        return;
      }
      message.success(data.message);
      setResult(null);
      setPendingFile(null);
      setClearOpen(false);
    } catch {
      message.error("Không nhận được kết quả xóa. Hãy kiểm tra dữ liệu trước khi thử lại.");
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => {
    fetch("/api/catalogs?kind=IMPORT")
      .then((r) => r.json())
      .then((j) => setProfiles(j.data || []));
  }, []);

  const handleCustomUpload = async ({ file, onSuccess, onError }: any) => {
    try {
      setUploading(true);
      setPendingFile(null);
      setPendingSheet(null);
      setResult(null);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("importType", importMode);
      formData.append("smartMerge", smartMerge ? "true" : "false");
      if (profileId) formData.append("profileId", profileId);

      const res = await fetch("/api/excel-engine/import", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (json.success) {
        setResult(json);
        setPendingFile(file);
        message.info(
          `Đã kiểm tra file (${json.detectedTypeName || "Excel"}); chưa ghi dữ liệu. Xem kết quả rồi xác nhận.`,
        );
        onSuccess("ok");
      } else {
        message.error(json.message || "Lỗi xử lý file Excel");
        onError(new Error(json.message));
      }
    } catch (err: any) {
      message.error(`Không thể tải file: ${err?.message || "Kiểm tra kết nối và thử lại."}`);
      onError(err);
    } finally {
      setUploading(false);
    }
  };

  const commitImport = async () => {
    if (!pendingFile && !pendingSheet) return;

    setUploading(true);
    try {
      const data = new FormData();
      if (pendingFile) data.append("file", pendingFile);
      data.append("confirm", "true");
      const options = result?.importOptions || { smartMerge, importType: importMode, profileId };
      data.append("smartMerge", options.smartMerge ? "true" : "false");
      data.append("importType", options.importType);
      if (result?.importRunId) data.append("importRunId", result.importRunId);

      if (options.profileId) data.append("profileId", options.profileId);

      if (result?.previewFingerprint) data.append("previewFingerprint", result.previewFingerprint);
      const r = pendingSheet
        ? await fetch("/api/google-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pendingSheet, action: "commit", confirm: true }) })
        : await fetch("/api/excel-engine/import", { method: "POST", body: data });
      const j = await r.json();
      if (j.success) {
        setResult(j);
        setPendingFile(null);
        setPendingSheet(null);
        const newWorkerMessage =
          j.detectedType === "DS_THUONG"
            ? ` Đã tạo ${j.summary?.newWorkerCount || 0} hồ sơ lao động mới.`
            : "";
        message.success(
          j.replayed ? "Phiên đã ghi trước đó; đã kiểm tra snapshot nguồn và không ghi trùng." : `Đã ghi nhận ${j.sourceRowsSaved} dòng nguồn; ${j.normalizedSaved} dòng được ghi/cập nhật vào hồ sơ nghiệp vụ.${newWorkerMessage}`,
        );
      } else {
        setResult((previous: any) => ({ ...previous, importRunId: j.importRunId || previous?.importRunId, recoveryState: j.recoveryState }));
        message.error(j.message || "Lỗi khi nhập dữ liệu");
      }
    } catch {
      message.error("Chưa nhận được kết quả. Giữ nguyên phiên và bấm xác nhận lại để kiểm tra; không quét thành phiên mới khi chưa rõ kết quả.");
    } finally {
      setUploading(false);
      setRecoveryVersion(version => version + 1);
    }
  };

  const duplicateMessages = new Set((result?.review?.duplicates || []).map((issue: any) => issue.message));
  const invalidRows = (result?.normalizationErrors || result?.errors || []).filter((text: string) => !duplicateMessages.has(text)).map((text: string, index: number) => ({ key: index, row: /^Dòng (\d+):/.exec(text)?.[1] || "—", message: text }));

  return (
    <div className="space-y-6">
      {/* Header Title */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
            Nhập và đồng bộ dữ liệu
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Hỗ trợ tự động nhận diện và nạp cả 3 loại bảng:{" "}
            <b>Hồ sơ tổng (DS_TONG)</b>, <b>Bảng thưởng (DS_THUONG)</b>, và{" "}
            <b>Đối soát STK Ngân hàng</b>.
          </p>
        </div>

      </div>

      {/* Khối Tự Động Đồng Bộ Google Sheets (Hỗ trợ quy mô 100.000 dòng) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Tabs className="min-w-0 flex-1" activeKey={inputTab} onChange={setInputTab} items={[{ key: "GOOGLE_SHEET", label: "Google Sheets" }, { key: "FILE", label: "Tải file Excel" }]} />
        <Button danger icon={<Trash2 className="h-4 w-4" />} disabled={uploading || clearing} onClick={() => setClearOpen(true)}>
          Xóa dữ liệu đã nhập
        </Button>
      </div>
      <Modal
        title="Xóa dữ liệu đã nhập trên toàn hệ thống"
        open={clearOpen}
        onCancel={() => { if (!clearing) setClearOpen(false); }}
        onOk={handleClearImportedData}
        okText="Xóa dữ liệu đã nhập"
        cancelText="Hủy"
        confirmLoading={clearing}
        closable={!clearing}
        maskClosable={!clearing}
        keyboard={!clearing}
        cancelButtonProps={{ disabled: clearing }}
        okButtonProps={{ danger: true }}
      >
        <Alert type="warning" showIcon message="Áp dụng cho tất cả nguồn nhập, không chỉ Sheet đang chọn." />
        <p className="mt-3">Xóa dữ liệu đã nhập và các bản ghi liên quan trong ứng dụng. File Excel và Google Sheets gốc được giữ nguyên. Hệ thống tạo bản sao lưu trước khi xóa.</p>
        <p className="mt-3">Tắt tự động đồng bộ và chờ các lần nhập hoàn tất để tránh dữ liệu được nạp lại.</p>
      </Modal>
      <div hidden={inputTab !== "GOOGLE_SHEET"}><GoogleSheetSyncCard onPreview={(data) => { setResult(data); setPendingFile(null); setPendingSheet(data.previewSource || null); }} /></div>

      <div hidden={inputTab !== "FILE"}>
        {/* Khối Nhập File Excel Đa Năng */}
        <Card
          title={
            <span className="flex items-center gap-2 text-slate-800 font-bold">
              <UploadCloud className="w-5 h-5 text-blue-600" />
              Nạp File Dữ Liệu Excel (.xlsx)
            </span>
          }
          className="shadow-sm border-slate-200"
        >
          <details className="mb-4"><summary className="cursor-pointer text-sm font-semibold text-slate-600">Tùy chọn nâng cao</summary>
          {/* Chế độ chọn loại file */}
          <div className="mb-4">
            <div className="text-xs font-semibold text-slate-600 mb-1.5">
              Chọn chế độ phân loại file nạp:
            </div>
            <Segmented
              block
              value={importMode}
              onChange={(val) => {
                setImportMode(String(val));
                setPendingFile(null);
                setResult(null);
              }}
              options={[
                {
                  label: "Tự động nhận diện",
                  value: "AUTO",
                  icon: (
                    <Sparkles className="w-3.5 h-3.5 inline mr-1 text-purple-600" />
                  ),
                },
                {
                  label: "DS_TONG",
                  value: "DS_TONG",
                  icon: (
                    <Users className="w-3.5 h-3.5 inline mr-1 text-blue-600" />
                  ),
                },
                {
                  label: "DS_THUONG",
                  value: "DS_THUONG",
                  icon: (
                    <Coins className="w-3.5 h-3.5 inline mr-1 text-amber-600" />
                  ),
                },
                {
                  label: "STK Ngân Hàng",
                  value: "BANK_ACCOUNTS",
                  icon: (
                    <CreditCard className="w-3.5 h-3.5 inline mr-1 text-emerald-600" />
                  ),
                },
              ]}
            />
          </div>

          {importMode === "DS_TONG" && (
            <Select
              className="w-full mb-4"
              allowClear
              placeholder="Mẫu DS_TONG mặc định / chọn ánh xạ cột tùy chỉnh"
              value={profileId || undefined}
              onChange={(v) => {
                setProfileId(v || "");
                setPendingFile(null);
                setResult(null);
              }}
              options={profiles
                .filter((p) => p.isActive)
                .map((p) => ({ value: p.id, label: p.name }))}
            />
          )}

          {/* Tùy chọn Bổ sung thông tin còn thiếu (Smart Merge) */}
          <div className="mb-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center justify-between">
              <Checkbox
                checked={smartMerge}
                onChange={(e) => setSmartMerge(e.target.checked)}
                className="text-xs font-semibold text-slate-800"
              >
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  Tự động bổ sung thông tin còn thiếu (Smart Merge)
                </span>
              </Checkbox>
              <Tag
                color={smartMerge ? "blue" : "default"}
                className="text-[10px] m-0 font-medium"
              >
                {smartMerge ? "Đang bật" : "Tắt"}
              </Tag>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
              Nếu đợt tuyển đã có trong hệ thống nhưng file mới có thêm SĐT, Mã
              NV, Ngày đi làm, STK... hệ thống sẽ tự động điền bù vào các ô còn
              trống mà không ghi đè dữ liệu cũ.
            </p>
          </div>

          </details>

            <Dragger
              name="file"
              multiple={false}
              accept=".xlsx"
              customRequest={handleCustomUpload}
              showUploadList={false}
              disabled={uploading}
              className="p-6 bg-slate-50 border-2 border-dashed border-slate-300 rounded-xl hover:border-blue-400"
            >
              <p className="ant-upload-drag-icon flex justify-center mb-3">
                <UploadCloud className="w-12 h-12 text-blue-500 animate-bounce" />
              </p>
              <p className="text-sm font-bold text-slate-800">
                Nhấp hoặc kéo thả file Excel vào khu vực này
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Hệ thống tự động phát hiện: <b>DS_TONG</b>, <b>DS_THUONG</b>,
                hoặc <b>STK ngân hàng</b>. Tối đa 50 MB / 100.000 dòng mỗi Sheet.
              </p>
            </Dragger>



        </Card>

      </div>
      <Card title="Kết quả quét và ghi dữ liệu" hidden={!result}>
          {/* Kết quả sau khi nạp */}
          {result && (
            <div className="mt-6 space-y-4">
              {/* Huy hiệu nhận diện loại file */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-100 rounded-lg border border-slate-200">
                <div className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <span>Loại file phát hiện:</span>
                  <Tag
                    color={
                      result.detectedType === "COMBINED"
                        ? "purple"
                        : result.detectedType === "DS_THUONG"
                          ? "gold"
                          : result.detectedType === "BANK_ACCOUNTS"
                            ? "green"
                            : "blue"
                    }
                    className="font-bold text-xs px-2 py-0.5"
                  >
                    {result.detectedTypeName || result.detectedType}
                  </Tag>
                </div>
                {result.sheetUsed && (
                  <span className="text-[11px] text-slate-500">
                    Sheet sử dụng: <b>{result.sheetUsed}</b>
                  </span>
                )}
              </div>

              {result.detectedType === "COMBINED" && (
                <Alert
                  type="success"
                  showIcon
                  message="Đã tự động phát hiện và ghép nối 2 Sheet: 'DS Tổng' (Hồ sơ & Đợt tuyển) + 'Thưởng' (Chính sách thưởng gắn trực tiếp vào từng đợt tuyển theo Số CCCD + Ngày PV)."
                />
              )}

              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <h4 className="font-bold text-emerald-800 flex items-center gap-2 text-sm mb-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Kết Quả Xử Lý Dữ Liệu
                </h4>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-center">
                  {[
                    {
                      label: "Tổng dòng",
                      value: result.summary?.totalRows,
                      color: "text-slate-800",
                    },
                    {
                      label: result.preview ? "Hợp lệ, sẵn sàng ghi" : "Đã ghi hồ sơ",
                      value: result.preview
                        ? result.summary?.readyCount
                        : result.summary?.successCount,
                      color: "text-emerald-700",
                    },
                    {
                      label: "Bổ sung thông tin",
                      value: result.summary?.mergedCount || 0,
                      color: "text-blue-700",
                    },
                    {
                      label: "Dòng trùng lặp",
                      value: result.summary?.duplicateCount || 0,
                      color: "text-rose-700",
                    },
                    {
                      label: "Không thể chuẩn hóa",
                      value: result.summary?.errorCount || 0,
                      color: "text-red-700",
                    },
                  ].map((item) => (
                    <div key={item.label} className="bg-white p-3 rounded-lg">
                      <div className={`text-sm ${item.color}`}>
                        {item.label}
                      </div>
                      <div className={`text-xl font-bold ${item.color}`}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {result.detectedType === "DS_THUONG" &&
                result.summary?.newWorkerCount > 0 && (
                  <Alert
                    type="info"
                    showIcon
                    message={`${result.summary.newWorkerCount} CCCD chưa có hồ sơ; xác nhận sẽ tạo hồ sơ tối thiểu từ họ tên và CCCD. Thưởng chưa gắn đợt tuyển và cần quyền ghi hồ sơ.`}
                  />
                )}

              <p className="text-xs text-slate-600">
                Đếm theo số dòng. {result.mainSourceRows ?? 0} dòng vào danh
                sách chính (trong đó có {result.summary?.mergedCount ?? 0} dòng
                tự động điền bù thông tin trống); {result.pendingDuplicateCount ?? 0} dòng
                trùng lặp (lệch thông tin hoặc đang làm cty khác) được tách riêng chờ duyệt.
              </p>
              {result.preview && (pendingFile || pendingSheet) && (
                  <Popconfirm
                    title="Xác nhận nạp dữ liệu vào hệ thống"
                    description={
                      smartMerge
                        ? "Dữ liệu mới và các thông tin bổ sung sẽ được cập nhật vào hệ thống. Các dòng trùng lặp sẽ được tách sang mục Cảnh báo Trùng lặp."
                        : "Ghi nhận dòng dữ liệu vào danh sách chính và đưa dòng trùng vào mục Cảnh báo Trùng lặp."
                    }
                    okText="Ghi vào CSDL ngay"
                    cancelText="Hủy"
                    okButtonProps={{
                      className:
                        "bg-emerald-600 hover:bg-emerald-500 font-semibold",
                    }}
                    onConfirm={commitImport}
                  >
                    <Button
                      type="primary"
                      size="large"
                      block
                      loading={uploading}
                      className="bg-emerald-600 hover:bg-emerald-500 font-bold shadow-md text-white"
                    >
                      Ghi {result.summary?.readyCount || 0} bản ghi vào danh sách và
                      tách {result.summary?.duplicateCount || 0} dòng trùng
                    </Button>
                  </Popconfirm>
                )}

              <Alert type={result.preview ? "info" : "success"} showIcon message={result.preview ? "Đã quét xong, chưa ghi dữ liệu. Kiểm tra các nhóm bên dưới rồi bấm Ghi bản ghi vào danh sách." : `Đã lưu ${result.sourceRowsSaved || 0} dòng nguồn; ghi/cập nhật ${result.normalizedSaved || 0} bản ghi nghiệp vụ; ${result.pendingDuplicateCount || 0} dòng chờ rà soát trùng.`} />
              {result.preview && result.readyRows?.length > 0 && <div className="space-y-2"><h4 className="font-semibold text-emerald-700">Dòng hợp lệ — xem trước tối đa 50 dòng</h4><Table size="small" rowKey={(row: any) => String(row.row) + row.idCard} dataSource={result.readyRows} pagination={{ pageSize: 10 }} scroll={{ x: 650 }} columns={[{ title: "Dòng", dataIndex: "row" }, { title: "Họ tên", dataIndex: "fullName" }, { title: "CCCD", dataIndex: "idCard" }, { title: "Nhà máy phỏng vấn", dataIndex: "factory" }]} /></div>}
              {invalidRows.length > 0 && <div className="space-y-2"><h4 className="font-semibold text-red-700">Dòng không hợp lệ — cần sửa</h4><Table size="small" rowKey="key" dataSource={invalidRows} pagination={{ pageSize: 10 }} columns={[{ title: "Dòng", dataIndex: "row", width: 90 }, { title: "Lý do", dataIndex: "message" }]} /></div>}

              {(result.summary?.duplicateCount || 0) > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-700">
                      Danh sách Dòng trùng lặp ({result.summary?.duplicateCount || 0} dòng)
                    </span>
                    <a
                      className="text-xs font-semibold text-blue-600 hover:underline"
                      href="/duplicates"
                    >
                      Mở trang Kiểm tra & Xử lý Cảnh báo Trùng lặp →
                    </a>
                  </div>
                  <Table<any>
                    size="small"
                    rowKey={(r, i) => `${r.row}-${i}`}
                    pagination={{ pageSize: 10 }}
                    dataSource={result.review?.duplicates || []}
                    columns={[
                      {
                        title: "Dòng Excel",
                        dataIndex: "row",
                        width: 100,
                      },
                      {
                        title: "Loại trùng",
                        dataIndex: "kind",
                        width: 170,
                        render: (v: string) =>
                          (
                            ({
                              BANK_ACCOUNT: "STK đã có",
                              PHONE: "Trùng SĐT",
                              ACTIVE_IDENTITY: "Lệch thông tin hồ sơ",
                              CROSS_COMPANY: "Đang làm cty khác",
                              BONUS: "Thưởng đã có",
                              EXACT_RECRUITMENT: "Lượt tuyển đã có",
                            }) as Record<string, string>
                          )[v] || v,
                      },
                      { title: "Chi tiết", dataIndex: "message" },
                    ]}
                  />
                </div>
              )}
            </div>
          )}
      </Card>
      <Collapse items={[{ key: "exports", label: "Mẫu Excel và xuất dữ liệu", children: (<>
        {/* Tải File Mẫu Chuẩn & Xuất Dữ Liệu */}
        <Card
          title="Tải File Mẫu Chuẩn & Xuất Dữ Liệu"
          className="shadow-sm border-slate-200"
        >
          <div className="space-y-3.5">
            {/* Form 1: DS_TONG */}
            <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h4 className="font-bold text-blue-900 text-sm flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                  1. Mẫu File DS_TONG (4 Sheet)
                </h4>
                <p className="text-xs text-blue-700 mt-0.5">
                  Gồm 4 sheet: `DS_TONG`, `Tháng cũ`, `Cảnh báo trùng lặp`,
                  `Link`. Chỉ sử dụng nhà máy phỏng vấn.
                </p>
              </div>
              <a href="/api/excel-engine/export?type=TEMPLATE_DS_TONG">
                <Button type="primary" icon={<Download className="w-4 h-4" />}>
                  Tải Mẫu DS_TONG
                </Button>
              </a>
            </div>

            {/* Form 2: DS_THUONG */}
            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h4 className="font-bold text-amber-900 text-sm flex items-center gap-1.5">
                  <Coins className="w-4 h-4 text-amber-600" />
                  2. Mẫu File DS_THUONG (Thưởng Lần 1 → 7)
                </h4>
                <p className="text-xs text-amber-700 mt-0.5">
                  Gồm các sheet: `DS_THUONG`, `T01_2026`, `T02_2026`, `Link`,
                  `Theo dõi thưởng`.
                </p>
              </div>
              <a href="/api/excel-engine/export?type=TEMPLATE_DS_THUONG">
                <Button
                  className="bg-amber-600 hover:bg-amber-500 text-white font-semibold border-none"
                  icon={<Download className="w-4 h-4" />}
                >
                  Tải Mẫu DS_THUONG
                </Button>
              </a>
            </div>

            {/* Form 3: STK Ngân Hàng */}
            <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h4 className="font-bold text-emerald-900 text-sm flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  3. Mẫu File STK Ngân Hàng (Đối Soát Tài Khoản)
                </h4>
                <p className="text-xs text-emerald-700 mt-0.5">
                  Gồm các tab: `STK ngân hàng 2026`, `T09.2026`, `T10.2026` kèm
                  người check & kết quả.
                </p>
              </div>
              <a href="/api/excel-engine/export?type=TEMPLATE_STK">
                <Button
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold border-none"
                  icon={<Download className="w-4 h-4" />}
                >
                  Tải Mẫu STK
                </Button>
              </a>
            </div>

            {/* Xuất dữ liệu thực tế */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">
                  Xuất Toàn Bộ Dữ Liệu Hồ Sơ Thực Tế (`DS_TONG`)
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Xuất tất cả hồ sơ hiện có theo thứ tự cột của
                  sheet `DS_TONG`
                </p>
              </div>
              <a href="/api/excel-engine/export?type=WORKERS">
                <Button icon={<FileSpreadsheet className="w-4 h-4" />}>
                  Xuất Dữ Liệu DS_TONG
                </Button>
              </a>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">
                  Danh Sách Cảnh Báo Trùng (`Cảnh báo trùng`)
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Mẫu: `CCCD, Họ và Tên, Nhà máy PV, Tình Trạng, Ngày PV, Loại
                  Cảnh Báo`
                </p>
              </div>
              <a href="/duplicates">
                <Button danger icon={<Download className="w-4 h-4" />}>
                  Xem & Xuất Cảnh Báo Trùng
                </Button>
              </a>
            </div>

          </div>
        </Card>
      </>) }]} />
      <ImportRecoveryAndLinks refreshToken={recoveryVersion} />
    </div>
  );
}
