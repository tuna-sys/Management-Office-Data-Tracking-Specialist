"use client";

import React, { useEffect, useState, useRef } from "react";
import {
  Table,
  Button,
  Tag,
  Card,
  message,
  Alert,
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
import DuplicateReviewEditor, { type EditableField } from "./DuplicateReviewEditor";
import type { ColumnsType } from "antd/es/table";
import { formatDate } from "@/lib/date-format";
import { comparisonState, displayReviewMonth, isEmptyComparison } from "@/lib/duplicate-comparison";
import { sameFactory, sameInterviewDay } from "@/lib/duplicate-check";

interface SideData {
  title?: string;
  fullName?: string;
  idCard?: string;
  phone?: string;
  gender?: string;
  dob?: string;
  province?: string;
  address?: string;
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
  category: "MERGE_INFO" | "CROSS_COMPANY" | "INTERVIEW_CONFLICT";
  canApprove?: boolean;
  blockedApprovalReason?: string;
  conflicts?: string[];
  targetAssignmentId?: string | null;
  reviewToken?: string;
  editReviewToken?: string;
  editableFields?: EditableField[];
  extraRows?: Array<{label: string; leftVal: string; rightVal: string}>;
  reviewFields?: Array<{key:string;label:string;before:any;after:any}>;
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

function displayBonusMonth(side: SideData): string {
  return displayReviewMonth(side.month, side.interviewDate);
}

export default function DuplicatesPage() {
  const [duplicates, setDuplicates] = useState<DuplicateAlert[]>([]);
  const [counts, setCounts] = useState<{
    mergeInfoCount: number;
    crossCompanyCount: number;
    conflictCount: number;
    unchangedCount: number;
  }>({
    mergeInfoCount: 0,
    crossCompanyCount: 0,
    conflictCount: 0,
    unchangedCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [inspectItem, setInspectItem] = useState<DuplicateAlert | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const [totalDuplicates, setTotalDuplicates] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const loadDetail = async (item: DuplicateAlert, signal?: AbortSignal): Promise<DuplicateAlert> => {
    const response = await fetch("/api/duplicates?id=" + encodeURIComponent(item.id), { cache: "no-store", signal });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "Không tải được chi tiết");
    return result.data;
  };
  const openReview = async (item: DuplicateAlert) => {
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller;
    try { const detail = await loadDetail(item, controller.signal); if (!controller.signal.aborted) setInspectItem(detail); }
    catch (error: any) { if (!controller.signal.aborted) message.error(error.message || "Không tải được chi tiết"); }
  };
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const fetchDuplicates = async () => {
    listRequest.current?.abort();
    const controller = new AbortController(); listRequest.current = controller;
    try {
      setLoading(true);
      const params = new URLSearchParams({ view: "list", page: String(currentPage), pageSize: String(pageSize), category: typeFilter, search: searchKeyword });
      const res = await fetch("/api/duplicates?" + params, { cache: "no-store", signal: controller.signal });
      const json = await res.json();
      if (controller.signal.aborted) return;
      if (json.success) {
        setTotalDuplicates(json.totalDuplicates || 0);
        setFilteredTotal(json.filteredTotal || 0);
        if (json.page) setCurrentPage(json.page);
        setDuplicates(json.data || []);
        if (json.counts) {
          setCounts({
            mergeInfoCount: json.counts.mergeInfoCount || 0,
            crossCompanyCount: json.counts.crossCompanyCount || 0,
            conflictCount: json.counts.conflictCount || 0,
            unchangedCount: json.counts.unchangedCount || 0,
          });
        }
      } else {
        message.error(json.message || "Lỗi tải danh sách cảnh báo trùng");
      }
    } catch {
      if (!controller.signal.aborted) message.error("Lỗi tải danh sách cảnh báo trùng");
    } finally {
      if (listRequest.current === controller) setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => { void fetchDuplicates(); }, 250);
    return () => { clearTimeout(timer); listRequest.current?.abort(); };
  }, [currentPage, pageSize, typeFilter, searchKeyword]);
  useEffect(() => () => { detailRequest.current?.abort(); }, []);

  const handleAction = async (
    item: DuplicateAlert,
    action: "APPROVE" | "DELETE",
    decision?: Record<string, any>,
  ) => {
    if (item.sourceId && !item.reviewToken) {
      try { return await handleAction(await loadDetail(item), action, decision); }
      catch (error: any) { message.error(error.message || "Không tải được dữ liệu mới nhất"); return; }
    }
    if (item.sourceId && !decision) decision={resolution:action==="APPROVE"?"APPROVE_SOURCE":"DISCARD_SOURCE",confirmResolution:true,targetAssignmentId:item.targetAssignmentId,reviewToken:item.reviewToken};
    try {
      setActionBusy(`${item.id}-${action}`);
      const res = await fetch("/api/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...decision,
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

  const filteredDuplicates = duplicates;

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
        if (r.category === "INTERVIEW_CONFLICT") return <div><Tag color="red">XUNG ĐỘT LƯỢT TUYỂN</Tag><div className="text-xs text-red-700">Người duyệt chọn cách xử lý</div></div>;
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
                📝 Chỉ bổ sung ô trống, giữ thông tin đã có
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
      render: (_, r) => (
        <div className="flex flex-col gap-1.5">
          <Button size="small" icon={<Eye className="w-3.5 h-3.5" />} onClick={()=>openReview(r)}>Kiểm tra</Button>
          <Popconfirm title="Duyệt dữ liệu mới?" description="Lưu lịch sử trước/sau cùng người duyệt rồi áp dụng dữ liệu mới." onConfirm={()=>handleAction(r,"APPROVE")}><Button size="small" type="primary" loading={actionBusy===`${r.id}-APPROVE`}>Duyệt</Button></Popconfirm>
          {r.sourceId && <Popconfirm title="Xóa dòng nhập mới khỏi hàng chờ?" description="Hồ sơ và lịch sử đang có được giữ nguyên." onConfirm={()=>handleAction(r,"DELETE")}><Button size="small" danger loading={actionBusy===`${r.id}-DELETE`}>Xóa</Button></Popconfirm>}
        </div>
      ),
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
            Đối chiếu dữ liệu trùng và xử lý theo từng nhóm. Thông tin mâu thuẫn được giữ nguyên để xác minh.
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

            <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc nhóm cảnh báo">
              {[
                {value:"ALL",label:"Tất cả",count:totalDuplicates},
                {value:"INTERVIEW_CONFLICT",label:"Cần xác minh",count:counts.conflictCount},
                {value:"MERGE_INFO",label:"Bổ sung ô trống",count:counts.mergeInfoCount},
                {value:"CROSS_COMPANY",label:"Chuyển công ty",count:counts.crossCompanyCount},
              ].filter(group => group.value === "ALL" || group.count > 0 || group.value === typeFilter).map(group => (
                <Button key={group.value} type={typeFilter === group.value ? "primary" : "default"} danger={group.value === "INTERVIEW_CONFLICT"} aria-pressed={typeFilter === group.value} onClick={() => {setTypeFilter(group.value);setCurrentPage(1);}}>
                  {group.label} ({group.count})
                </Button>
              ))}
            </div>

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
            Hiển thị <strong>{filteredTotal}</strong> /{" "}
            {totalDuplicates} trường hợp
            {counts.unchangedCount > 0 && <span className="block text-xs text-slate-500 mt-1">Đã ẩn {counts.unchangedCount.toLocaleString("vi-VN")} dòng không có thay đổi; giữ nguyên dữ liệu nguồn.</span>}
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
          scroll={{ x: 1500, y: "max(180px, calc(100dvh - 440px))" }}
          pagination={{
            current: currentPage,
            total: filteredTotal,
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
        width="min(1200px, calc(100vw - 40px))"
        style={{ top: 20 }}
        styles={{ body: { maxHeight: "calc(100dvh - 190px)", overflowY: "auto" } }}
        title={
          <div className="flex items-center gap-2 text-slate-900">
            <ArrowRightLeft className="w-5 h-5 text-blue-600" />
            <span>
              {inspectItem?.category === "INTERVIEW_CONFLICT" ? "Thông tin khác nhau — cần xác minh" : inspectItem?.category === "MERGE_INFO"
                ? "Kiểm tra bổ sung thông tin còn trống"
                : "Kiểm tra công nhân đang làm công ty này nhưng PV / đi làm công ty khác"}
            </span>
          </div>
        }
        footer={
          inspectItem?.sourceId ? (
            <div className="flex items-center justify-between gap-2">
              <Button onClick={()=>setInspectItem(null)}>Đóng</Button>
              <div className="flex gap-2">
                <DuplicateReviewEditor key={inspectItem.id} item={inspectItem} onSaved={async () => { setInspectItem(null); await fetchDuplicates(); }} />
                <Popconfirm title="Xóa dòng nhập mới khỏi hàng chờ?" description="Giữ nguyên hồ sơ và lịch sử đang có." onConfirm={()=>handleAction(inspectItem,"DELETE")}><Button danger loading={actionBusy===`${inspectItem.id}-DELETE`}>Xóa</Button></Popconfirm>
                <Popconfirm title="Duyệt dữ liệu mới?" description="Lưu lịch sử trước/sau và người duyệt rồi áp dụng dữ liệu mới." onConfirm={()=>handleAction(inspectItem,"APPROVE")}><Button type="primary" disabled={inspectItem.canApprove === false} title={inspectItem.blockedApprovalReason} loading={actionBusy===`${inspectItem.id}-APPROVE`}>Duyệt</Button></Popconfirm>
              </div>
            </div>
          ) : inspectItem ? (
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <Button onClick={() => setInspectItem(null)}>Đóng</Button>
              <div className="flex items-center gap-2">
                <Popconfirm
                  disabled={inspectItem.canApprove === false}
                  title="Xóa bản ghi trùng này?"
                  description={`Loại bỏ bản ghi trùng của ${inspectItem.fullName} khỏi danh sách?`}
                  onConfirm={() => handleAction(inspectItem, "DELETE")}
                  okText="Xóa bản ghi"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    danger
                    disabled={inspectItem.canApprove === false}
                    loading={actionBusy === `${inspectItem.id}-DELETE`}
                    icon={<Trash2 className="w-4 h-4" />}
                  >
                    Xóa bản ghi trùng
                  </Button>
                </Popconfirm>
                <Popconfirm
                  disabled={inspectItem.canApprove === false}
                  title={
                    inspectItem.category === "MERGE_INFO"
                      ? "Duyệt bổ sung các ô trống?"
                      : "Duyệt chuyển công ty cho công nhân này?"
                  }
                  description={
                    inspectItem.category === "MERGE_INFO"
                      ? "Chỉ điền các ô trống, không thay thông tin đã có."
                      : `Hệ thống sẽ tự động cập nhật đợt tại "${inspectItem.currentFactory}" sang "Đã nghỉ việc" và giữ lại đợt mới tại "${inspectItem.newFactory}".`
                  }
                  onConfirm={() => handleAction(inspectItem, "APPROVE")}
                  okText="Duyệt ngay"
                  cancelText="Hủy"
                >
                  <Button
                    type="primary"
                    disabled={inspectItem.canApprove === false}
                    loading={actionBusy === `${inspectItem.id}-APPROVE`}
                    icon={<Check className="w-4 h-4" />}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {inspectItem.category === "INTERVIEW_CONFLICT" ? "Thông tin khác nhau — cần xác minh" : inspectItem.category === "MERGE_INFO"
                      ? "Chỉ bổ sung ô trống"
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
                inspectItem.category !== "MERGE_INFO"
                  ? "bg-rose-50 border-rose-200 text-rose-900"
                  : "bg-blue-50 border-blue-200 text-blue-950"
              }`}
            >
              <div className="font-bold text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  {inspectItem.category === "INTERVIEW_CONFLICT" ? "Thông tin khác nhau — cần xác minh" : inspectItem.category === "MERGE_INFO"
                    ? "Trường hợp 1: Bổ sung thông tin còn trống"
                    : "Trường hợp 2: Đang làm công ty này nhưng PV / đi làm ở công ty khác"}
                </span>
              </div>
              <div>{inspectItem.warning}</div>
              {inspectItem.blockedApprovalReason && <Alert type="info" showIcon message={inspectItem.blockedApprovalReason} />}
              {inspectItem.category === "INTERVIEW_CONFLICT" && <Alert type="warning" showIcon message="Cần quyết định của người duyệt" description={(inspectItem.conflicts || []).join("; ") + ". Bấm Duyệt để áp dụng dữ liệu mới và lưu lịch sử trước/sau; bấm Xóa để bỏ dòng nhập mới."} />}
              <div className="font-semibold pt-0.5">
                {inspectItem.category === "INTERVIEW_CONFLICT" ? "Duyệt: áp dụng dữ liệu mới, lưu lịch sử trước/sau và người duyệt. Xóa: chỉ bỏ dòng nhập mới, giữ hồ sơ hiện có." : <>👉 Khi bấm &ldquo;Duyệt&rdquo;:{" "}
                {inspectItem.category === "MERGE_INFO"
                  ? "Chỉ bổ sung các ô trống; giữ nguyên thông tin và lịch sử đã có."
                  : `Tự động chuyển trạng thái tại "${inspectItem.currentFactory}" sang "Đã nghỉ việc" và giữ đợt mới tại "${inspectItem.newFactory}" hoạt động bình thường.`}</>}
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
                  label: "Tỉnh/Thành",
                  leftVal: left.province || "—",
                  rightVal: right.province || "—",
                },
                {
                  label: "Địa chỉ/Quê quán",
                  leftVal: left.address || "—",
                  rightVal: right.address || "—",
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
                inspectItem.importType === "DS_THUONG" ||
                [left.month, right.month, left.totalBonus, right.totalBonus,
                  left.bonusDetails, right.bonusDetails, left.bankInfo, right.bankInfo]
                  .some(value => !isEmptyComparison(value))
              ) {
                baseRows.push(
                  {
                    label: "Tháng thưởng",
                    leftVal: displayBonusMonth(left),
                    rightVal: displayBonusMonth(right),
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

              baseRows.push(...(inspectItem.extraRows || []));

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
                      const differentCompanies =
                        !!left.factory && !!right.factory &&
                        left.factory !== "—" && right.factory !== "—" &&
                        !sameFactory(left.factory, right.factory);
                      const sameDayCompanyConflict =
                        differentCompanies && !!left.idCard &&
                        left.idCard === right.idCard && sameInterviewDay(left, right);
                      const differentEmployerCode =
                        differentCompanies && r.label === "Mã nhân viên";
                      const dateConflict =
                        sameDayCompanyConflict && r.label === "Ngày phỏng vấn";
                      const state = comparisonState(r.label, r.leftVal, r.rightVal, left, right);
                      const isAdded = state.added;
                      const isConflict = dateConflict || (!differentEmployerCode && state.conflict);

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
                                {inspectItem.category === "INTERVIEW_CONFLICT" ? "Chỉ có ở nguồn" : "Bổ sung mới"}
                              </Tag>
                            )}
                            {isConflict && (
                              <Tag
                                color="red"
                                className="m-0 text-[10px] px-1 leading-tight"
                              >
                                {dateConflict
                                  ? "Trùng ngày PV tại hai công ty"
                                  : r.label === "Công ty / Nhà máy" && differentCompanies
                                    ? "Khác công ty"
                                    : "Mâu thuẫn"}
                              </Tag>
                            )}
                            {differentEmployerCode && r.leftVal !== "—" && r.rightVal !== "—" && r.leftVal !== r.rightVal && (
                              <Tag color="blue" className="m-0 text-[10px] px-1 leading-tight">Khác mã theo công ty</Tag>
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
