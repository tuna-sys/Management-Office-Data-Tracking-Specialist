"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  Table,
  Button,
  Tag,
  Card,
  message,
  Alert,
  Select,
  Input,
  Modal,
  Popconfirm,
} from "antd";
import {
  ShieldAlert,
  Download,
  RefreshCw,
  Search,
  AlertTriangle,
  Eye,
  Check,
  Trash2,
  ArrowRightLeft,
  FilePlus2,
  Building2,
} from "lucide-react";
import type { ColumnsType } from "antd/es/table";
import { formatDate } from "@/lib/date-format";

interface SideData {
  title?: string;
  fullName?: string;
  idCard?: string;
  phone?: string;
  gender?: string;
  dob?: string;
  province?: string;
  employeeCode?: string;
  factory?: string;
  interviewDate?: string;
  status?: string;
  leaveDate?: string;
  leaveReason?: string;
  recruiter?: string;
  month?: string;
  totalBonus?: string;
  bonusDetails?: string;
  bankInfo?: string;
}

interface DuplicateAlert {
  id: string;
  category: "MERGE_INFO" | "CROSS_COMPANY";
  type: string;
  severity: "CRITICAL" | "HIGH" | "WARNING" | "INFO";
  sourceId?: string;
  row?: number;
  fileName?: string;
  importType?: string;
  phone?: string;
  idCard: string;
  fullName: string;
  currentFactory: string;
  currentStatus: string;
  currentInterviewDate?: string;
  newFactory: string;
  newStatus: string;
  newInterviewDate?: string;
  recruiter: string;
  newRecruiter?: string;
  warning: string;
  actionRequired: string;
  workerId?: string | null;
  currentAssignmentId?: string | null;
  newAssignmentId?: string | null;
  leftSide?: SideData;
  rightSide?: SideData;
}

export default function DuplicatesPage() {
  const [duplicates, setDuplicates] = useState<DuplicateAlert[]>([]);
  const [counts, setCounts] = useState<{
    mergeInfoCount: number;
    crossCompanyCount: number;
  }>({
    mergeInfoCount: 0,
    crossCompanyCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [inspectItem, setInspectItem] = useState<DuplicateAlert | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const fetchDuplicates = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/duplicates", { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setDuplicates(json.data || []);
        if (json.counts) {
          setCounts({
            mergeInfoCount: json.counts.mergeInfoCount || 0,
            crossCompanyCount: json.counts.crossCompanyCount || 0,
          });
        }
      } else {
        message.error(json.message || "Lỗi tải danh sách cảnh báo trùng");
      }
    } catch {
      message.error("Lỗi tải danh sách cảnh báo trùng");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDuplicates();
  }, []);

  const handleAction = async (
    item: DuplicateAlert,
    action: "APPROVE" | "DELETE",
  ) => {
    try {
      setActionBusy(`${item.id}-${action}`);
      const res = await fetch("/api/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          id: item.id,
          category: item.category,
          type: item.type,
          sourceId: item.sourceId,
          row: item.row,
          workerId: item.workerId,
          currentAssignmentId: item.currentAssignmentId,
          newAssignmentId: item.newAssignmentId,
          newInterviewDate: item.newInterviewDate,
          idCard: item.idCard,
          fullName: item.fullName,
        }),
      });
      const json = await res.json();
      if (json.success) {
        message.success(json.message);
        if (inspectItem?.id === item.id) {
          setInspectItem(null);
        }
        await fetchDuplicates();
      } else {
        message.error(json.message || "Không thể xử lý cảnh báo");
      }
    } catch {
      message.error("Lỗi kết nối khi xử lý cảnh báo");
    } finally {
      setActionBusy(null);
    }
  };

  // Lọc dữ liệu hiển thị theo đúng 2 trường hợp
  const filteredDuplicates = useMemo(() => {
    return duplicates.filter((item) => {
      if (typeFilter !== "ALL") {
        if (typeFilter === "MERGE_INFO" && item.category !== "MERGE_INFO")
          return false;
        if (typeFilter === "CROSS_COMPANY" && item.category !== "CROSS_COMPANY")
          return false;
      }

      if (searchKeyword.trim()) {
        const kw = searchKeyword.trim().toLowerCase();
        const target =
          `${item.fullName || ""} ${item.idCard || ""} ${item.phone || ""} ${item.currentFactory || ""} ${item.newFactory || ""} ${item.recruiter || ""} ${item.warning || ""}`.toLowerCase();
        if (!target.includes(kw)) return false;
      }

      return true;
    });
  }, [duplicates, typeFilter, searchKeyword]);

  const handleExportExcel = async () => {
    try {
      const r = await fetch("/api/excel-engine/export?type=DUPLICATES");
      if (!r.ok) {
        const j = await r.json();
        message.error(j.message);
        return;
      }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "CanhBaoTrung_TriThucViet.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      message.error("Không thể xuất cảnh báo");
    }
  };

  const columns: ColumnsType<DuplicateAlert> = [
    {
      title: "STT",
      key: "stt",
      width: 55,
      align: "center",
      render: (_, __, idx) => (
        <span className="font-semibold text-slate-500 text-xs">
          {(currentPage - 1) * pageSize + idx + 1}
        </span>
      ),
    },
    {
      title: "Người lao động",
      key: "worker",
      width: 210,
      render: (_, r) => (
        <div className="space-y-0.5">
          <div className="font-bold text-slate-900 text-xs">{r.fullName}</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[11px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
              {r.idCard}
            </span>
            {r.phone && (
              <span className="text-[11px] text-slate-600 font-mono">
                {r.phone}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      title: "Trường hợp trùng lặp",
      key: "category",
      width: 220,
      render: (_, r) => {
        if (r.category === "MERGE_INFO") {
          return (
            <div className="space-y-1 max-w-[205px]">
              <Tag
                color="blue"
                className="font-bold text-[11px] m-0 inline-flex items-center gap-1 px-2 py-0.5 rounded max-w-full"
              >
                <FilePlus2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="truncate">TH1: BỔ SUNG HỒ SƠ</span>
              </Tag>
              <div className="text-[10px] text-blue-700 font-medium leading-tight">
                📝 Ghi đè thông tin còn thiếu / mới
              </div>
            </div>
          );
        }
        return (
          <div className="space-y-1 max-w-[205px]">
            <Tag
              color="red"
              className="font-bold text-[11px] m-0 inline-flex items-center gap-1 px-2 py-0.5 rounded max-w-full"
            >
              <Building2 className="w-3.5 h-3.5 text-red-600 shrink-0" />
              <span className="truncate">TH2: TRÙNG CHÉO CÔNG TY</span>
            </Tag>
            <div className="text-[10px] text-red-600 font-medium leading-tight">
              🚨 Đang làm việc nhưng PV cty khác
            </div>
          </div>
        );
      },
    },
    {
      title: "Hồ sơ / Công ty hiện tại",
      key: "currentFactory",
      width: 195,
      render: (_, r) => (
        <div className="text-xs space-y-0.5 max-w-[185px]">
          <div className="font-semibold text-slate-800 break-words">{r.currentFactory}</div>
          <div className="text-[11px] text-slate-500">
            Trạng thái:{" "}
            <strong className="text-slate-700">{r.currentStatus}</strong>
          </div>
          {r.recruiter && r.recruiter !== "—" && (
            <div className="text-[10px] text-slate-400">
              Tuyển dụng: {r.recruiter}
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Thông tin bổ sung / Công ty mới",
      key: "newFactory",
      width: 210,
      render: (_, r) => (
        <div className="text-xs space-y-0.5 max-w-[200px]">
          <div className="font-semibold text-slate-800 break-words">{r.newFactory}</div>
          <div className="text-[11px] text-slate-500">
            {r.newInterviewDate && r.newInterviewDate !== "—"
              ? `Ngày PV: ${formatDate(r.newInterviewDate)} `
              : ""}
            {r.newStatus && r.newStatus !== "—" ? `(${r.newStatus})` : ""}
          </div>
          {r.newRecruiter && r.newRecruiter !== "—" && (
            <div className="text-[10px] text-slate-400">
              TD mới: {r.newRecruiter}
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Chi tiết & Hướng xử lý",
      key: "warningDetail",
      render: (_, r) => {
        const isCross = r.category === "CROSS_COMPANY";
        return (
          <div
            className={`p-2.5 rounded-lg text-xs space-y-1.5 ${
              isCross
                ? "bg-rose-50/80 border border-rose-200"
                : "bg-blue-50/60 border border-blue-200"
            }`}
          >
            <div
              className={`font-semibold ${
                isCross ? "text-rose-900" : "text-blue-950"
              }`}
            >
              {r.warning}
            </div>
            <div
              className={`text-[11px] flex items-start gap-1 ${
                isCross ? "text-rose-700 font-medium" : "text-blue-800"
              }`}
            >
              <span className="shrink-0 font-bold">👉 Hướng xử lý:</span>
              <span>{r.actionRequired}</span>
            </div>
          </div>
        );
      },
    },
    {
      title: "Thao tác",
      key: "actions",
      width: 175,
      fixed: "right",
      align: "center",
      render: (_, r) => {
        const approveDesc =
          r.category === "MERGE_INFO"
            ? "Hệ thống sẽ ghi đè và bổ sung toàn bộ thông tin mới đầy đủ hơn vào hồ sơ hiện có."
            : `Hệ thống sẽ tự động cập nhật đợt tại "${r.currentFactory}" sang "Đã nghỉ việc" và giữ lại đợt mới tại "${r.newFactory}".`;
        return (
          <div className="flex flex-col gap-1.5 max-w-[150px] mx-auto">
            <div className="flex items-center gap-1.5">
              <Button
                size="small"
                icon={<Eye className="w-3.5 h-3.5" />}
                onClick={() => setInspectItem(r)}
                className="flex-1 text-xs font-medium text-blue-600 border-blue-200 bg-blue-50/60 hover:bg-blue-100"
              >
                Kiểm tra
              </Button>
              <Popconfirm
                title={
                  r.category === "MERGE_INFO"
                    ? "Duyệt bổ sung / ghi đè thông tin hồ sơ?"
                    : "Duyệt chuyển công ty mới?"
                }
                description={approveDesc}
                onConfirm={() => handleAction(r, "APPROVE")}
                okText="Duyệt ngay"
                cancelText="Hủy"
              >
                <Button
                  size="small"
                  type="primary"
                  loading={actionBusy === `${r.id}-APPROVE`}
                  icon={<Check className="w-3.5 h-3.5" />}
                  className="flex-1 text-xs font-medium bg-emerald-600 hover:bg-emerald-700"
                >
                  Duyệt
                </Button>
              </Popconfirm>
            </div>
            <Popconfirm
              title="Xóa bản ghi phát sinh trùng này?"
              description={`Loại bỏ bản ghi trùng của ${r.fullName} khỏi hệ thống?`}
              onConfirm={() => handleAction(r, "DELETE")}
              okText="Xóa bản ghi"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
            >
              <Button
                size="small"
                danger
                loading={actionBusy === `${r.id}-DELETE`}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                className="w-full text-xs font-medium"
              >
                Xóa
              </Button>
            </Popconfirm>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <ShieldAlert className="w-6 h-6 text-rose-600" />
            <span>Kiểm tra & Xử lý Cảnh báo Trùng lặp</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản lý tập trung 2 trường hợp trùng lặp: (1) Bổ sung thông tin còn
            thiếu vào hồ sơ & (2) Đang làm công ty này nhưng PV / đi làm công ty
            khác.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            icon={
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
              />
            }
            onClick={fetchDuplicates}
          >
            Quét lại
          </Button>
          <Button
            type="primary"
            danger
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={handleExportExcel}
          >
            Xuất Excel Cảnh báo
          </Button>
        </div>
      </div>

      {/* 2 Thẻ KPI tương ứng đúng 2 Trường hợp */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          size="small"
          className={`cursor-pointer transition-all border-blue-300 bg-blue-50/50 hover:shadow-sm ${
            typeFilter === "MERGE_INFO" ? "ring-2 ring-blue-600" : ""
          }`}
          onClick={() => {
            setTypeFilter(typeFilter === "MERGE_INFO" ? "ALL" : "MERGE_INFO");
            setCurrentPage(1);
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-800">
              Trường hợp 1: Trùng bổ sung / ghi đè thông tin hồ sơ
            </span>
            <FilePlus2 className="w-5 h-5 text-blue-600" />
          </div>
          <div className="mt-1.5 text-2xl font-bold text-blue-700">
            {counts.mergeInfoCount}
            <span className="text-xs font-normal text-slate-500 ml-1.5">
              hồ sơ chờ duyệt ghi đè
            </span>
          </div>
          <p className="mt-1 text-xs text-blue-700 font-medium">
            📝 Các ô đang trống đã được hệ thống tự động điền khi nạp file. Các
            bản ghi lệch giá trị hiện tại đây để bạn bấm <b>Duyệt</b> ghi đè.
          </p>
        </Card>

        <Card
          size="small"
          className={`cursor-pointer transition-all border-rose-300 bg-rose-50/50 hover:shadow-sm ${
            typeFilter === "CROSS_COMPANY" ? "ring-2 ring-rose-600" : ""
          }`}
          onClick={() => {
            setTypeFilter(
              typeFilter === "CROSS_COMPANY" ? "ALL" : "CROSS_COMPANY",
            );
            setCurrentPage(1);
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Trường hợp 2: Đang làm công ty này nhưng PV / đi làm công ty khác
            </span>
            <Building2 className="w-5 h-5 text-rose-600" />
          </div>
          <div className="mt-1.5 text-2xl font-bold text-rose-700">
            {counts.crossCompanyCount}
            <span className="text-xs font-normal text-slate-500 ml-1.5">
              trường hợp nhảy xưởng / đa công ty
            </span>
          </div>
          <p className="mt-1 text-xs text-rose-700 font-medium">
            🚨 Công nhân đang làm việc tại công ty cũ (chưa báo nghỉ) nhưng lại
            hiện đang phỏng vấn hoặc đi làm ở công ty mới.
          </p>
        </Card>
      </div>

      {/* Alert giải thích cơ chế tự động */}
      <Alert
        message="Cơ chế tự động bổ sung thông tin (Smart Merge)"
        description="Khi bạn upload lại file có đầy đủ thông tin hơn (Giới tính, Ngày sinh, SĐT, Tỉnh/Quê quán, Mã NV, STK, hoặc các mốc thưởng mới), hệ thống đã TỰ ĐỘNG GHI ĐÈ VÀO CÁC Ô CÒN THIẾU. Bảng dưới đây chỉ hiển thị các dòng xung đột giá trị cần duyệt ghi đè (Trường hợp 1) và các công nhân đang làm công ty này nhưng phỏng vấn/đi làm ở công ty khác (Trường hợp 2)."
        type="info"
        showIcon
        className="border-blue-200 bg-blue-50/50 text-xs"
      />

      {/* Filter Bar */}
      <Card size="small" className="shadow-xs border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
            <Input
              className="w-full sm:w-64"
              placeholder="Tìm tên, CCCD, SĐT, công ty..."
              prefix={<Search className="w-3.5 h-3.5 text-slate-400" />}
              value={searchKeyword}
              onChange={(e) => {
                setSearchKeyword(e.target.value);
                setCurrentPage(1);
              }}
              allowClear
            />

            <Select
              className="w-full sm:w-96"
              value={typeFilter}
              onChange={(v) => {
                setTypeFilter(v);
                setCurrentPage(1);
              }}
              options={[
                {
                  label: `Tất cả cảnh báo trùng (${duplicates.length})`,
                  value: "ALL",
                },
                {
                  label: `📝 TH1: Bổ sung / Ghi đè thông tin hồ sơ (${counts.mergeInfoCount})`,
                  value: "MERGE_INFO",
                },
                {
                  label: `🚨 TH2: Đang làm công ty này nhưng PV / đi làm công ty khác (${counts.crossCompanyCount})`,
                  value: "CROSS_COMPANY",
                },
              ]}
            />

            {(typeFilter !== "ALL" || searchKeyword) && (
              <Button
                size="middle"
                onClick={() => {
                  setTypeFilter("ALL");
                  setSearchKeyword("");
                  setCurrentPage(1);
                }}
                className="text-xs"
              >
                Đặt lại
              </Button>
            )}
          </div>

          <div className="text-xs text-slate-500 font-medium">
            Hiển thị <strong>{filteredDuplicates.length}</strong> /{" "}
            {duplicates.length} trường hợp
          </div>
        </div>
      </Card>

      {/* Bảng Cảnh báo */}
      <Card size="small" className="shadow-xs border-slate-200 overflow-hidden">
        <Table<DuplicateAlert>
          columns={columns}
          dataSource={filteredDuplicates}
          rowKey={(r) => r.id}
          loading={loading}
          scroll={{ x: 1380 }}
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            showSizeChanger: true,
            pageSizeOptions: ["10", "20", "50", "100"],
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size);
            },
            showTotal: (total, range) =>
              `${range[0]} - ${range[1]} / ${total} trường hợp`,
          }}
          size="middle"
        />
      </Card>

      {/* Modal Kiểm tra Đối chiếu Chi tiết 2 cột */}
      <Modal
        open={!!inspectItem}
        onCancel={() => setInspectItem(null)}
        width={840}
        title={
          <div className="flex items-center gap-2 text-slate-900">
            <ArrowRightLeft className="w-5 h-5 text-blue-600" />
            <span>
              {inspectItem?.category === "MERGE_INFO"
                ? "Kiểm tra bổ sung & ghi đè thông tin hồ sơ"
                : "Kiểm tra công nhân đang làm công ty này nhưng PV / đi làm công ty khác"}
            </span>
          </div>
        }
        footer={
          inspectItem ? (
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <Button onClick={() => setInspectItem(null)}>Đóng</Button>
              <div className="flex items-center gap-2">
                <Popconfirm
                  title="Xóa bản ghi trùng này?"
                  description={`Loại bỏ bản ghi trùng của ${inspectItem.fullName} khỏi danh sách?`}
                  onConfirm={() => handleAction(inspectItem, "DELETE")}
                  okText="Xóa bản ghi"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    danger
                    loading={actionBusy === `${inspectItem.id}-DELETE`}
                    icon={<Trash2 className="w-4 h-4" />}
                  >
                    Xóa bản ghi trùng
                  </Button>
                </Popconfirm>
                <Popconfirm
                  title={
                    inspectItem.category === "MERGE_INFO"
                      ? "Duyệt ghi đè & bổ sung thông tin này?"
                      : "Duyệt chuyển công ty cho công nhân này?"
                  }
                  description={
                    inspectItem.category === "MERGE_INFO"
                      ? "Hệ thống sẽ cập nhật toàn bộ thông tin đầy đủ ở cột bên phải vào hồ sơ CSDL."
                      : `Hệ thống sẽ tự động cập nhật đợt tại "${inspectItem.currentFactory}" sang "Đã nghỉ việc" và giữ lại đợt mới tại "${inspectItem.newFactory}".`
                  }
                  onConfirm={() => handleAction(inspectItem, "APPROVE")}
                  okText="Duyệt ngay"
                  cancelText="Hủy"
                >
                  <Button
                    type="primary"
                    loading={actionBusy === `${inspectItem.id}-APPROVE`}
                    icon={<Check className="w-4 h-4" />}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {inspectItem.category === "MERGE_INFO"
                      ? "Duyệt & Ghi đè thông tin đầy đủ"
                      : "Duyệt & Chuyển công ty cũ sang Đã nghỉ"}
                  </Button>
                </Popconfirm>
              </div>
            </div>
          ) : null
        }
      >
        {inspectItem && (
          <div className="space-y-4 mt-2">
            {/* Banner tóm tắt lý do trùng */}
            <div
              className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                inspectItem.category === "CROSS_COMPANY"
                  ? "bg-rose-50 border-rose-200 text-rose-900"
                  : "bg-blue-50 border-blue-200 text-blue-950"
              }`}
            >
              <div className="font-bold text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  {inspectItem.category === "MERGE_INFO"
                    ? "Trường hợp 1: Trùng bổ sung / ghi đè thông tin hồ sơ"
                    : "Trường hợp 2: Đang làm công ty này nhưng PV / đi làm ở công ty khác"}
                </span>
              </div>
              <div>{inspectItem.warning}</div>
              <div className="font-semibold pt-0.5">
                👉 Khi bấm &ldquo;Duyệt&rdquo;:{" "}
                {inspectItem.category === "MERGE_INFO"
                  ? "Ghi đè và lấp đầy các thông tin từ cột phải (File mới) vào hồ sơ trong CSDL."
                  : `Tự động chuyển trạng thái tại "${inspectItem.currentFactory}" sang "Đã nghỉ việc" và giữ đợt mới tại "${inspectItem.newFactory}" hoạt động bình thường.`}
              </div>
            </div>

            {/* Bảng so sánh 2 cột */}
            {(() => {
              const left = inspectItem.leftSide || {};
              const right = inspectItem.rightSide || {};

              const baseRows = [
                {
                  label: "Họ và tên",
                  leftVal: left.fullName || "—",
                  rightVal: right.fullName || "—",
                },
                {
                  label: "Số CCCD",
                  leftVal: left.idCard || "—",
                  rightVal: right.idCard || "—",
                  isKey: true,
                },
                {
                  label: "Số điện thoại",
                  leftVal: left.phone || "—",
                  rightVal: right.phone || "—",
                },
                {
                  label: "Giới tính / Ngày sinh",
                  leftVal:
                    left.gender !== "—" || left.dob !== "—"
                      ? `${left.gender || "—"} • ${left.dob && left.dob !== "—" ? formatDate(left.dob) : "—"}`
                      : "—",
                  rightVal:
                    right.gender !== "—" || right.dob !== "—"
                      ? `${right.gender || "—"} • ${right.dob && right.dob !== "—" ? formatDate(right.dob) : "—"}`
                      : "—",
                },
                {
                  label: "Tỉnh / Quê quán",
                  leftVal: left.province || "—",
                  rightVal: right.province || "—",
                },
                {
                  label: "Mã nhân viên",
                  leftVal: left.employeeCode || "—",
                  rightVal: right.employeeCode || "—",
                },
                {
                  label: "Công ty / Nhà máy",
                  leftVal: left.factory || "—",
                  rightVal: right.factory || "—",
                },
                {
                  label: "Ngày phỏng vấn",
                  leftVal:
                    left.interviewDate && left.interviewDate !== "—"
                      ? formatDate(left.interviewDate)
                      : "—",
                  rightVal:
                    right.interviewDate && right.interviewDate !== "—"
                      ? formatDate(right.interviewDate)
                      : "—",
                },
                {
                  label: "Trạng thái làm việc",
                  leftVal: left.status || "—",
                  rightVal: right.status || "—",
                },
                {
                  label: "Ngày nghỉ việc",
                  leftVal:
                    left.leaveDate &&
                    left.leaveDate !== "—" &&
                    left.leaveDate !== "Chưa có ngày nghỉ"
                      ? formatDate(left.leaveDate)
                      : left.leaveDate || "—",
                  rightVal:
                    right.leaveDate && right.leaveDate !== "—"
                      ? formatDate(right.leaveDate)
                      : "—",
                },
                {
                  label: "Người tuyển dụng",
                  leftVal: left.recruiter || "—",
                  rightVal: right.recruiter || "—",
                },
              ];

              if (
                inspectItem.category === "MERGE_INFO" &&
                (left.totalBonus !== "—" ||
                  right.totalBonus !== "—" ||
                  left.bonusDetails !== "—" ||
                  right.bonusDetails !== "—" ||
                  left.bankInfo !== "—" ||
                  right.bankInfo !== "—")
              ) {
                baseRows.push(
                  {
                    label: "Tháng thưởng",
                    leftVal: left.month || "—",
                    rightVal: right.month || "—",
                  },
                  {
                    label: "Tổng thưởng",
                    leftVal: left.totalBonus || "—",
                    rightVal: right.totalBonus || "—",
                  },
                  {
                    label: "Chi tiết thưởng L1–L7",
                    leftVal: left.bonusDetails || "—",
                    rightVal: right.bonusDetails || "—",
                  },
                  {
                    label: "Ngân hàng / STK",
                    leftVal: left.bankInfo || "—",
                    rightVal: right.bankInfo || "—",
                  },
                );
              }

              return (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-12 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700">
                    <div className="col-span-3 p-2.5 border-r border-slate-200">
                      Trường thông tin
                    </div>
                    <div className="col-span-4 p-2.5 border-r border-slate-200 text-blue-800 bg-blue-50/60">
                      1. {left.title || "Hồ sơ đang có trong hệ thống"}
                    </div>
                    <div className="col-span-5 p-2.5 text-rose-800 bg-rose-50/60">
                      2. {right.title || "Thông tin bổ sung / Công ty mới"}
                    </div>
                  </div>
                  <div className="divide-y divide-slate-200 text-xs">
                    {baseRows.map((r, i) => {
                      const isAdded =
                        (r.leftVal === "—" || r.leftVal === "— • —") &&
                        r.rightVal !== "—" &&
                        r.rightVal !== "— • —";
                      const isConflict =
                        !isAdded &&
                        r.leftVal !== "—" &&
                        r.rightVal !== "—" &&
                        r.leftVal !== r.rightVal;

                      return (
                        <div
                          key={i}
                          className={`grid grid-cols-12 items-center ${
                            isAdded
                              ? "bg-emerald-50/70"
                              : isConflict
                                ? "bg-rose-50/70"
                                : r.isKey
                                  ? "bg-amber-50/50"
                                  : "bg-white"
                          }`}
                        >
                          <div className="col-span-3 p-2.5 font-semibold text-slate-600 border-r border-slate-200 flex items-center justify-between gap-1">
                            <span>{r.label}</span>
                            {isAdded && (
                              <Tag
                                color="green"
                                className="m-0 text-[10px] px-1 leading-tight"
                              >
                                Bổ sung mới
                              </Tag>
                            )}
                            {isConflict && (
                              <Tag
                                color="red"
                                className="m-0 text-[10px] px-1 leading-tight"
                              >
                                {inspectItem.category === "MERGE_INFO"
                                  ? "Ghi đè"
                                  : "Khác công ty"}
                              </Tag>
                            )}
                          </div>
                          <div className="col-span-4 p-2.5 border-r border-slate-200 font-medium text-slate-800 break-words">
                            {r.leftVal}
                          </div>
                          <div className="col-span-5 p-2.5 font-semibold text-slate-900 break-words">
                            {r.rightVal}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>
    </div>
  );
}
