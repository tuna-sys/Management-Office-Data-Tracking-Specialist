"use client";
import AssignmentFields from "@/components/AssignmentFields";
import DateField from "@/components/DateField";
import { formatDate } from "@/lib/date-format";
import { STATUSES } from "@/lib/worker-validation";
import { useIdentity } from "@/components/AuthGate";
import React, { useEffect, useState, useRef } from "react";
import {
  Table,
  Button,
  Input,
  Select,
  Tag,
  Modal,
  Form,
  message,
  Card,
  Space,
  Drawer,
  Descriptions,
  Tooltip,
  Alert,
  Popconfirm,
  DatePicker,
} from "antd";
import {
  UserPlus,
  Search,
  Download,
  Filter,
  AlertCircle,
  Edit3,
  Building,
  Eye,
  RotateCcw,
  ExternalLink,
  Trash2,
} from "lucide-react";
const FACTORIES = [
  "Luxshare QC",
  "Canon",
  "Goertek",
  "Fushan",
  "Amphenol",
  "Foxconn",
  "Luxshare VT",
  "LG",
  "Bảo vệ",
];
const DATE_FIELDS = new Set([
  "dob",
  "idCardDate",
  "interviewDate",
  "expectedTrainingDate",
  "standardTrainingDate",
  "leaveDate",
]);

export default function WorkersPage() {
  const user = useIdentity();
  const canWrite = user?.permissions.includes("worker:write");
  const [archived, setArchived] = useState(false);
  const [month, setMonth] = useState("");
  const [sourceMonth, setSourceMonth] = useState<string[]>([]);
  const [activeConfirm, setActiveConfirm] = useState(false);
  const [rehire, setRehire] = useState(false);
  const [historyWorker, setHistoryWorker] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [workers, setWorkers] = useState<any[]>([]);
  const requestRef = useRef<AbortController | null>(null);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [detailHistoryLoading, setDetailHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [factoryFilter, setFactoryFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [recruiterFilter, setRecruiterFilter] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<any>(null); // State mới lưu [Từ ngày, Đến ngày]
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sourceOptions, setSourceOptions] = useState<Record<string, string[]>>(
    {},
  );
  const [warningsOnly, setWarningsOnly] = useState(false);
  const [pendingDuplicateCount, setPendingDuplicateCount] = useState(0);
  const [systemWarningCount, setSystemWarningCount] = useState(0);
  const [sourceTotals, setSourceTotals] = useState({
    totalRows: 0,
    sourceRows: 0,
    warningRows: 0,
  });

  // Modal thêm mới
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  // Modal cập nhật nghỉ việc
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<any>(null);
  const [statusForm] = Form.useForm();

  // Drawer xem chi tiết hồ sơ
  const [detailRecord, setDetailRecord] = useState<any>(null);

  useEffect(() => () => requestRef.current?.abort(), []);
  const detailId = detailRecord?.id;
  useEffect(() => {
    if (!detailRecord?.workerId) return;
    const controller = new AbortController();
    setDetailHistoryLoading(true);
    const params = new URLSearchParams({ id: detailRecord.workerId, review: "true" });
    if (detailRecord.assignments?.[0]?.id) params.set("assignmentId", detailRecord.assignments[0].id);
    fetch("/api/worker-history?" + params, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error("history"); return r.json(); })
      .then(json => { if (!json.success) throw new Error("history"); setDetailRecord((previous: any) => previous?.id === detailId ? {...previous, reviewHistory: json.data} : previous); })
      .catch(() => { if (!controller.signal.aborted) message.error("Không tải được lịch sử thay đổi"); })
      .finally(() => { if (!controller.signal.aborted) setDetailHistoryLoading(false); });
    return () => controller.abort();
  }, [detailId]);

  const fetchWorkers = async (page = currentPage, size = pageSize) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      setLoading(true);

      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(size),
        archived: String(archived),
        month,
        // Chuyển mảng thành chuỗi phân tách bằng dấu phẩy
        sourceMonth: Array.isArray(sourceMonth)
          ? sourceMonth.join(",")
          : sourceMonth || "",
        recruiter: Array.isArray(recruiterFilter)
          ? recruiterFilter.join(",")
          : recruiterFilter || "",
        ...(warningsOnly ? { warningsOnly: "true" } : {}),
      });

      if (search) params.append("search", search);

      // Thêm các tham số lọc Multi-select
      if (Array.isArray(factoryFilter) && factoryFilter.length > 0) {
        params.append("factory", factoryFilter.join(","));
      } else if (typeof factoryFilter === "string" && factoryFilter) {
        params.append("factory", factoryFilter);
      }

      if (Array.isArray(statusFilter) && statusFilter.length > 0) {
        params.append("status", statusFilter.join(","));
      } else if (typeof statusFilter === "string" && statusFilter) {
        params.append("status", statusFilter);
      }

      // Thêm lọc khoảng thời gian Từ ngày - Đến ngày (Date Range)
      if (dateRange && dateRange[0]) {
        params.append("fromDate", dateRange[0].format("YYYY-MM-DD"));
      }
      if (dateRange && dateRange[1]) {
        params.append("toDate", dateRange[1].format("YYYY-MM-DD"));
      }

      const res = await fetch(`/api/worker-source-rows?${params.toString()}`, { signal: controller.signal });
      const json = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok || !json.success) throw new Error("worker-list");
      if (json.success) {
        setWorkers(json.data || []);
        setFilteredTotal(json.filteredTotal ?? json.data?.length ?? 0);
        if (json.page) setCurrentPage(json.page);
        setSourceOptions(json.options || {});
        setPendingDuplicateCount(json.pendingDuplicateCount || 0);
        setSystemWarningCount(json.systemWarningCount || 0);
        setSourceTotals({
          totalRows: json.totalRows || 0,
          sourceRows: json.sourceRows || 0,
          warningRows: json.warningRows || 0,
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) message.error("Lỗi tải danh sách hồ sơ");
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    fetchWorkers(1);
  }, [
    factoryFilter,
    statusFilter,
    archived,
    month,
    sourceMonth,
    recruiterFilter,
    warningsOnly,
  ]);

  const handleSearch = () => {
    setCurrentPage(1);
    fetchWorkers(1);
  };

  const handleResetFilters = () => {
    setSearch("");
    setFactoryFilter([]);
    setStatusFilter([]);
    setSourceMonth([]);
    setMonth("");
    setRecruiterFilter([]);
    setDateRange(null);
    setWarningsOnly(false);
    setCurrentPage(1);
  };

  // Xử lý thêm mới hồ sơ
  const handleAddWorker = async (values: any) => {
    try {
      setSubmitting(true);
      const res = await fetch("/api/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          rehire,
          confirmActiveDuplicate: activeConfirm,
        }),
      });
      const json = await res.json();
      if (json.success) {
        message.success("Đã thêm hồ sơ người lao động thành công!");
        setIsAddModalOpen(false);
        addForm.resetFields();
        fetchWorkers();
      } else {
        if (json.duplicateType === "ACTIVE_LABOR") {
          Modal.confirm({
            title: "CCCD đang làm/chưa đào tạo",
            content: json.message,
            onOk: async () => {
              const response = await fetch("/api/workers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...values,
                  rehire: true,
                  confirmActiveDuplicate: true,
                }),
              });
              const result = await response.json();
              if (!result.success) {
                message.error(result.message);
                throw new Error(result.message);
              }
              setIsAddModalOpen(false);
              fetchWorkers();
            },
          });
        } else if (json.duplicateType === "PHONE") {
          Modal.confirm({
            title: "Xác nhận dùng chung SĐT sau khi xác minh",
            content: json.message,
            onOk: async () => {
              const response = await fetch("/api/workers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...values,
                  rehire,
                  confirmPhoneDuplicate: true,
                }),
              });
              const result = await response.json();
              if (!result.success) {
                message.error(result.message);
                throw new Error(result.message);
              }
              setIsAddModalOpen(false);
              addForm.resetFields();
              fetchWorkers();
            },
          });
        } else if (json.isDuplicate) {
          Modal.error({
            title: "CẢNH BÁO TRÙNG LẶP DỮ LIỆU",
            content: json.message,
            okText: "Đã hiểu",
          });
        } else {
          message.error(json.message || "Lỗi thêm hồ sơ");
        }
      }
    } catch {
      message.error("Lỗi gửi dữ liệu lên máy chủ");
    } finally {
      setSubmitting(false);
    }
  };

  // Mở modal cập nhật trạng thái
  const handleOpenStatusModal = (worker: any) => {
    setSelectedWorker(worker);
    const assignment = worker.assignments?.[0] || {};
    const v = worker.sourceValues || {};

    statusForm.resetFields();

    // Prefer persisted values; use imported source values only as a fallback.
    const getVal = (...keys: string[]) => {
      for (const record of [assignment, worker.workerValues, worker]) {
        for (const key of keys) {
          const value = record?.[key];
          if (value !== undefined && value !== null && value !== "")
            return value;
        }
      }
      for (const key of keys) {
        const value = v[key];
        if (value !== undefined && value !== null && value !== "") return value;
      }
      return "";
    };

    statusForm.setFieldsValue({
      orderId: getVal("orderId"),
      batchId: getVal("batchId"),
      employeeCode: getVal("employeeCode", "Mã nhân viên", "Mã NV"),
      recruiterId: getVal("recruiterId"),
      teamId: getVal("teamId"),
      interviewResult: getVal("interviewResult", "Kết quả phỏng vấn"),
      passedDate: getVal("passedDate", "Ngày đỗ", "Ngày phỏng vấn đỗ"),
      startDate: getVal("startDate", "Ngày bắt đầu làm (sau ngày đỗ)"),
      confirmedWorkDays: getVal(
        "confirmedWorkDays",
        "Số công thực tế đã xác nhận",
      ),
      workDaysAsOf: getVal("workDaysAsOf", "Ngày chốt số công"),

      fullName: getVal("fullName", "Họ và tên"),
      phone: getVal("phone", "Số điện thoại", "SĐT"),
      dob: getVal("dob", "Ngày sinh"),
      gender: getVal("gender", "Giới tính"),
      code: getVal("code", "Mã hồ sơ"),
      idCardDate: getVal("idCardDate", "Ngày cấp CCCD", "Ngày cấp"),
      idCardPlace: getVal("idCardPlace", "Nơi cấp"),
      address: getVal("address", "Địa chỉ / Quê quán", "Địa chỉ"),
      province: getVal("province", "Tỉnh/Thành"),
      recruiter: getVal("recruiter", "Chuyên viên tuyển dụng", "Tuyển dụng"),
      team: getVal("team", "Team phụ trách", "Đội nhóm"),
      source: getVal("source", "Nguồn"),

      interviewFactory: getVal("interviewFactory", "Nhà máy PV"),
      workingFactory: getVal("workingFactory", "Nhà máy làm việc"),
      contractType: getVal("contractType", "Loại hợp đồng", "Loại HĐ"),
      shuttleBusKtx: getVal(
        "shuttleBusKtx",
        "Đón xe + KTX",
        "Đón xe - KTX",
        "Đón xe / KTX",
      ),
      interviewDate: getVal("interviewDate", "Ngày PV", "Ngày phỏng vấn"),
      expectedTrainingDate: getVal(
        "expectedTrainingDate",
        "Ngày Đào tạo dự kiến",
        "Ngày đào tạo dự kiến",
      ),
      expectedTrainingStatus: getVal(
        "expectedTrainingStatus",
        "Tình trạng đào tạo",
        "Tình trạng Đào tạo dự kiến",
        "TT ĐT dự kiến",
      ),
      standardTrainingDate: getVal(
        "standardTrainingDate",
        "Ngày đào tạo chuẩn",
        "Ngày ĐT chuẩn",
      ),
      onboardingMonth: getVal("onboardingMonth", "Tháng nhận việc"),
      status: getVal("status", "Tình trạng") || "Đang chờ phỏng vấn",
      leaveDate: getVal("leaveDate", "Ngày nghỉ việc (Ngày NH)", "Ngày NH"),
      leaveReason: getVal("leaveReason", "Lý do nghỉ việc", "Lý do"),
    });

    setIsStatusModalOpen(true);
  };

  // Xóa hồ sơ người lao động
  const handleDeleteWorker = async (record: any) => {
    if (!record) return;
    try {
      const targetId = record.workerId || record.id;
      const res = await fetch("/api/workers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: targetId,
          assignmentId: record.assignmentId || record.assignments?.[0]?.id,
          idCard: record.idCard,
          isSourceRow: record.isSourceRow,
          sourceId: record.sourceId,
          sourceRow: record.sourceRow,
        }),
      });
      const json = await res.json();
      if (json.success) {
        message.success("Đã xóa hồ sơ thành công");
        fetchWorkers();
      } else {
        message.error(json.message || "Không thể xóa hồ sơ");
      }
    } catch {
      message.error("Lỗi kết nối khi xóa");
    }
  };
  // Lưu cập nhật trạng thái
  const handleUpdateStatus = async (values: any) => {
    if (!selectedWorker) return;
    try {
      const targetId = selectedWorker.workerId || selectedWorker.id;
      const res = await fetch(`/api/workers/${targetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          assignmentId: selectedWorker.assignments?.[0]?.id,
          updatedAt: selectedWorker.updatedAt,
          assignmentUpdatedAt: selectedWorker.assignments?.[0]?.updatedAt,
        }),
      });
      const json = await res.json();
      if (json.success) {
        message.success("Đã cập nhật trạng thái hồ sơ");
        setIsStatusModalOpen(false);
        fetchWorkers();
      } else {
        message.error(json.message);
      }
    } catch {
      message.error("Lỗi cập nhật");
    }
  };

  const handleOpenHistory = async (record: any) => {
    const targetId = record.workerId || record.id;
    if (!targetId) return;
    try {
      setHistoryLoading(true);
      setHistoryWorker(record);
      const res = await fetch(`/api/worker-history?id=${targetId}`);
      const json = await res.json();
      if (json.success && json.data?.[0]) {
        setHistoryWorker(json.data[0]);
      }
    } catch {
      // Giữ record hiện tại
    } finally {
      setHistoryLoading(false);
    }
  };

  const getStatusTag = (status: string) => {
    const s = String(status || "").trim();
    if (!s) return <Tag>Chưa có TT</Tag>;
    if (["Đang làm việc", "LV", "Chuyển chính thức"].includes(s)) {
      return <Tag color="success">{s}</Tag>;
    }
    if (
      [
        "Đã nghỉ việc",
        "NH",
        "Nghỉ hẳn",
        "HHĐ",
        "Hết hợp đồng",
        "Tự ý nghỉ việc",
      ].includes(s)
    ) {
      return <Tag color="error">{s}</Tag>;
    }
    if (
      [
        "Bỏ xưởng",
        "Bỏ XX",
        "Bỏ ĐT",
        "Bỏ phỏng vấn",
        "Bỏ đào tạo",
        "Bỏ khác",
      ].includes(s)
    ) {
      return <Tag color="warning">{s}</Tag>;
    }
    if (["Trượt phỏng vấn", "Trượt KSK"].includes(s)) {
      return <Tag color="magenta">{s}</Tag>;
    }
    if (["Đang đào tạo", "Chưa đào tạo", "Đang chờ phỏng vấn"].includes(s)) {
      return <Tag color="processing">{s}</Tag>;
    }
    return <Tag color="default">{s}</Tag>;
  };

  // 22 CỘT CHUẨN TỪ FILE QUẢN LÝ
  const columns = [
    {
      title: "STT",
      key: "STT",
      width: 60,
      fixed: "left" as const,
      align: "center" as const,
      render: (_: any, __: any, index: number) =>
        (currentPage - 1) * pageSize + index + 1,
    },
    {
      title: "Họ và tên",
      key: "Họ và tên",
      width: 175,
      fixed: "left" as const,
      render: (_: any, record: any) => {
        const name =
          record.sourceValues?.["Họ và tên"] || record.fullName || "—";
        const hasWarning = (record.sourceWarnings || []).length > 0;
        return (
          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => setDetailRecord(record)}
              className="text-left font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer truncate"
              title={name}
            >
              {name}
            </button>
            {hasWarning && (
              <Tooltip
                title={`${record.sourceWarnings.length} cảnh báo cần kiểm tra`}
              >
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0 inline-block" />
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: "Số CCCD",
      key: "Số CCCD",
      width: 135,
      fixed: "left" as const,
      render: (_: any, record: any) => (
        <span className="font-mono text-xs text-slate-800">
          {record.sourceValues?.["Số CCCD"] || record.idCard || "—"}
        </span>
      ),
    },
    {
      title: "Nhà máy PV",
      key: "Nhà máy PV",
      width: 120,
      render: (_: any, record: any) =>
        record.sourceValues?.["Nhà máy PV"] || "—",
    },
    {
      title: "Nhà máy làm việc",
      key: "Nhà máy làm việc",
      width: 130,
      render: (_: any, record: any) =>
        record.sourceValues?.["Nhà máy làm việc"] || "—",
    },
    {
      title: "Loại HĐ",
      key: "Loại HĐ",
      width: 155,
      render: (_: any, record: any) => {
        const val =
          record.sourceValues?.["Loại HĐ"] ||
          record.sourceValues?.["Loại HD"] ||
          record.assignments?.[0]?.contractType;
        return val ? (
          <span className="font-medium text-xs text-slate-800">{val}</span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      title: "Tình trạng",
      key: "Tình trạng",
      width: 125,
      render: (_: any, record: any) =>
        getStatusTag(record.sourceValues?.["Tình trạng"]),
    },
    {
      title: "Ngày NH",
      key: "Ngày NH",
      width: 100,
      render: (_: any, record: any) => {
        const val = record.sourceValues?.["Ngày NH"];
        return val ? (
          <span className="text-rose-600 font-medium text-xs">
            {formatDate(val)}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      title: "Lý do",
      key: "Lý do",
      width: 150,
      ellipsis: true,
      render: (_: any, record: any) => record.sourceValues?.["Lý do"] || "—",
    },
    {
      title: "Mã NV",
      key: "Mã NV",
      width: 95,
      render: (_: any, record: any) => {
        const val = record.sourceValues?.["Mã NV"];
        return val ? (
          <span className="font-mono text-xs">{val}</span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      title: "Ngày sinh",
      key: "Ngày sinh",
      width: 100,
      render: (_: any, record: any) =>
        formatDate(record.sourceValues?.["Ngày sinh"]),
    },
    {
      title: "Giới tính",
      key: "Giới tính",
      width: 75,
      align: "center" as const,
      render: (_: any, record: any) =>
        record.sourceValues?.["Giới tính"] || "—",
    },
    {
      title: "Ngày cấp",
      key: "Ngày cấp",
      width: 100,
      render: (_: any, record: any) =>
        formatDate(record.sourceValues?.["Ngày cấp"]),
    },
    {
      title: "Địa chỉ",
      key: "Địa chỉ",
      width: 180,
      ellipsis: true,
      render: (_: any, record: any) => record.sourceValues?.["Địa chỉ"] || "—",
    },
    {
      title: "SĐT",
      key: "SĐT",
      width: 110,
      render: (_: any, record: any) => {
        const val = record.sourceValues?.["SĐT"];
        return val ? (
          <span className="font-mono text-xs">{val}</span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      title: "Tuyển dụng",
      key: "Tuyển dụng",
      width: 125,
      render: (_: any, record: any) =>
        record.sourceValues?.["Tuyển dụng"] || "—",
    },
    {
      title: "Đón xe + KTX",
      key: "Đón xe + KTX",
      width: 120,
      render: (_: any, record: any) => {
        const value = record.sourceValues?.["Đón xe + KTX"];
        return value !== undefined && value !== null && value !== ""
          ? String(value)
          : "—";
      },
    },
    {
      title: "Ngày PV",
      key: "Ngày PV",
      width: 100,
      render: (_: any, record: any) =>
        formatDate(record.sourceValues?.["Ngày PV"]),
    },
    {
      title: "Ngày Đào tạo dự kiến",
      key: "Ngày Đào tạo dự kiến",
      width: 120,
      render: (_: any, record: any) =>
        formatDate(record.sourceValues?.["Ngày Đào tạo dự kiến"]),
    },
    {
      title: "Tình trạng đào tạo",
      key: "Tình trạng đào tạo",
      width: 130,
      render: (_: any, record: any) => {
        const value = record.sourceValues?.["Tình trạng đào tạo"];
        return value !== undefined && value !== null && value !== ""
          ? String(value)
          : "—";
      },
    },
    {
      title: "Ngày đào tạo chuẩn",
      key: "Ngày đào tạo chuẩn",
      width: 120,
      render: (_: any, record: any) =>
        formatDate(record.sourceValues?.["Ngày đào tạo chuẩn"]),
    },
    {
      title: "Tháng nhận việc",
      key: "Tháng nhận việc",
      width: 110,
      render: (_: any, record: any) => {
        const val = record.sourceValues?.["Tháng nhận việc"];
        return val ? (
          <span className="font-semibold text-xs text-slate-800">{val}</span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      title: "Thao tác",
      key: "actions",
      width: 200,
      fixed: "right" as const,
      align: "center" as const,
      render: (_: any, record: any) => (
        <Space size={2}>
          <Button
            type="text"
            size="small"
            className="text-blue-600 hover:text-blue-800 px-1"
            icon={<Eye className="w-3.5 h-3.5 inline mr-0.5" />}
            onClick={() => setDetailRecord(record)}
          >
            Xem
          </Button>

          {canWrite && (
            <>
              <Button
                type="text"
                size="small"
                className="text-slate-600 hover:text-slate-800 px-1"
                icon={<Edit3 className="w-3.5 h-3.5 inline mr-0.5" />}
                onClick={() => handleOpenStatusModal(record)}
              >
                Sửa
              </Button>

              <Popconfirm
                title="Xóa hồ sơ"
                description="Bạn có chắc chắn muốn xóa hồ sơ này không?"
                onConfirm={() => handleDeleteWorker(record)}
                okText="Xóa"
                cancelText="Hủy"
                okButtonProps={{ danger: true }}
              >
                <Button
                  type="text"
                  size="small"
                  className="text-red-600 hover:text-red-800 px-1"
                  icon={<Trash2 className="w-3.5 h-3.5 inline mr-0.5" />}
                >
                  Xóa
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Danh sách người lao động
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Hiển thị đầy đủ 22 cột quản lý nguồn Excel. Khóa cố định cột Họ tên
            &amp; CCCD khi cuộn ngang.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/api/excel-engine/export?type=WORKERS">
            <Button icon={<Download className="w-4 h-4" />}>
              Xuất Excel DS_TONG
            </Button>
          </a>
          <Button
            type="primary"
            disabled={!canWrite}
            icon={<UserPlus className="w-4 h-4" />}
            onClick={() => {
              setRehire(false);
              addForm.resetFields();
              setIsAddModalOpen(true);
            }}
          >
            Thêm Hồ Sơ Mới
          </Button>
        </div>
      </div>

      {/* Filter Card */}
      <Card className="shadow-sm border-slate-200">
        <div className="space-y-4">
          {/* Hàng 1: Ô tìm kiếm & Chọn khoảng thời gian Từ ngày - Đến ngày */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Tìm kiếm
              </label>
              <Input
                placeholder="Tên, CCCD, SĐT, Mã NV..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onPressEnter={handleSearch}
                prefix={<Search className="w-3.5 h-3.5 text-slate-400" />}
                allowClear
              />
            </div>

            {/* Mới: Bộ lọc khoảng ngày (Từ ngày - Đến ngày) */}
            <div className="lg:col-span-4">
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Khoảng thời gian (Từ ngày - Đến ngày)
              </label>
              <DatePicker.RangePicker
                className="w-full"
                format="DD/MM/YYYY"
                placeholder={["Từ ngày", "Đến ngày"]}
                value={dateRange} // Khai báo state: const [dateRange, setDateRange] = useState(null);
                onChange={(dates) => setDateRange(dates)}
              />
            </div>
          </div>

          {/* Hàng 2: Bộ lọc Multi-Select (Chọn nhiều) cho Nhà máy, Tình trạng, Tháng, Tuyển dụng */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 1. Nhà máy phỏng vấn */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Nhà máy phỏng vấn (Chọn nhiều)
              </label>
              <Select
                mode="multiple"
                maxTagCount="responsive"
                className="w-full"
                allowClear
                placeholder="Tất cả nhà máy"
                value={factoryFilter || []}
                onChange={(selectedValues) => {
                  const allList = sourceOptions["Nhà máy PV"] || [];
                  if (selectedValues.includes("ALL")) {
                    if ((factoryFilter || []).length === allList.length) {
                      setFactoryFilter([]);
                    } else {
                      setFactoryFilter(allList);
                    }
                  } else {
                    setFactoryFilter(selectedValues);
                  }
                }}
                options={[
                  { value: "ALL", label: "--- Chọn tất cả ---" },
                  ...(sourceOptions["Nhà máy PV"] || []).map((value) => ({
                    value,
                    label: value,
                  })),
                ]}
              />
            </div>

            {/* 2. Tình trạng */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Tình trạng (Chọn nhiều)
              </label>
              <Select
                mode="multiple"
                maxTagCount="responsive"
                className="w-full"
                allowClear
                placeholder="Tất cả tình trạng"
                value={statusFilter || []}
                onChange={(selectedValues) => {
                  const allList = sourceOptions["Tình trạng"] || [];
                  if (selectedValues.includes("ALL")) {
                    if ((statusFilter || []).length === allList.length) {
                      setStatusFilter([]);
                    } else {
                      setStatusFilter(allList);
                    }
                  } else {
                    setStatusFilter(selectedValues);
                  }
                }}
                options={[
                  { value: "ALL", label: "--- Chọn tất cả ---" },
                  ...(sourceOptions["Tình trạng"] || []).map((value) => ({
                    value,
                    label: value,
                  })),
                ]}
              />
            </div>

            {/* 3. Tháng nhận việc */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Tháng nhận việc (Chọn nhiều)
              </label>
              <Select
                mode="multiple"
                maxTagCount="responsive"
                className="w-full"
                allowClear
                placeholder="Tất cả tháng nhận việc"
                value={sourceMonth || []}
                onChange={(selectedValues) => {
                  const allList = sourceOptions["Tháng nhận việc"] || [];
                  if (selectedValues.includes("ALL")) {
                    if ((sourceMonth || []).length === allList.length) {
                      setSourceMonth([]);
                    } else {
                      setSourceMonth(allList);
                    }
                  } else {
                    setSourceMonth(selectedValues);
                  }
                }}
                options={[
                  { value: "ALL", label: "--- Chọn tất cả ---" },
                  ...(sourceOptions["Tháng nhận việc"] || []).map((value) => ({
                    value,
                    label: value,
                  })),
                ]}
              />
            </div>

            {/* 4. Người tuyển dụng */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Người tuyển dụng (Chọn nhiều)
              </label>
              <Select
                mode="multiple"
                maxTagCount="responsive"
                className="w-full"
                allowClear
                placeholder="Tất cả tuyển dụng"
                value={recruiterFilter || []}
                onChange={(selectedValues) => {
                  const allList = sourceOptions["Tuyển dụng"] || [];
                  if (selectedValues.includes("ALL")) {
                    if ((recruiterFilter || []).length === allList.length) {
                      setRecruiterFilter([]);
                    } else {
                      setRecruiterFilter(allList);
                    }
                  } else {
                    setRecruiterFilter(selectedValues);
                  }
                }}
                options={[
                  { value: "ALL", label: "--- Chọn tất cả ---" },
                  ...(sourceOptions["Tuyển dụng"] || []).map((value) => ({
                    value,
                    label: value,
                  })),
                ]}
              />
            </div>
          </div>

          {/* Hàng 3: Nút bấm thao tác giữ nguyên */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="primary"
                onClick={handleSearch}
                icon={<Filter className="w-4 h-4" />}
              >
                Áp dụng lọc
              </Button>
              <Button
                onClick={handleResetFilters}
                icon={<RotateCcw className="w-4 h-4" />}
              >
                Đặt lại
              </Button>
              <Button
                type={warningsOnly ? "primary" : "default"}
                danger={warningsOnly}
                onClick={() => setWarningsOnly(!warningsOnly)}
              >
                {warningsOnly
                  ? "Đang lọc: Chỉ dòng cảnh báo"
                  : "Chỉ dòng cảnh báo"}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <a
                className="text-amber-700 font-semibold hover:underline"
                href="/import-review?type=warnings"
              >
                Xem luồng cảnh báo (
                {(
                  systemWarningCount || sourceTotals.warningRows
                ).toLocaleString("vi-VN")}
                )
              </a>
              <span className="text-slate-300">|</span>
              <a
                className="text-rose-600 font-semibold hover:underline"
                href="/import-review?type=duplicates"
              >
                Trùng lặp chờ duyệt (
                {pendingDuplicateCount.toLocaleString("vi-VN")})
              </a>
            </div>
          </div>
        </div>
      </Card>

      {/* Main Table Card */}
      <Card className="shadow-sm border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Button
              type={!archived ? "primary" : "default"}
              size="small"
              onClick={() => {
                setArchived(false);
                setCurrentPage(1);
              }}
              className="font-semibold text-xs"
            >
              Hồ sơ hiện hành
            </Button>
            <Button
              type={archived ? "primary" : "default"}
              size="small"
              onClick={() => {
                setArchived(true);
                setCurrentPage(1);
              }}
              className="font-semibold text-xs"
            >
              Hồ sơ lưu trữ
            </Button>
          </div>

          <div className="text-xs text-slate-500 font-medium">
            Hiển thị <strong>{workers.length.toLocaleString("vi-VN")}</strong>{" "}
            dòng / {sourceTotals.totalRows.toLocaleString("vi-VN")} dòng nguồn
            tổng
          </div>
        </div>

        <Table
          columns={columns}
          dataSource={workers}
          rowKey="id"
          loading={loading}
          scroll={{ x: 2700 }}
          bordered
          size="small"
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: filteredTotal,
            showSizeChanger: true,
            pageSizeOptions: ["10", "20", "50", "100", "200"],
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size);
              fetchWorkers(page, size);
            },
            showTotal: (total, range) =>
              `${range[0]} - ${range[1]} / ${total} dòng nguồn / lượt tuyển`,
          }}
          locale={{
            emptyText: "Không tìm thấy dòng phù hợp với bộ lọc hiện tại.",
          }}
        />
      </Card>

      {/* Drawer Xem Chi Tiết Toàn Bộ 22 Trường */}
      <Drawer
        title={
          <div className="flex items-center justify-between pr-4">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-slate-900">
                {detailRecord?.sourceValues?.["Họ và tên"] ||
                  detailRecord?.fullName ||
                  "Chi tiết hồ sơ"}
              </span>
              {getStatusTag(detailRecord?.sourceValues?.["Tình trạng"])}
            </div>
            {detailRecord?.workerId && (
              <a
                href={`/workers/${detailRecord.workerId}`}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-normal"
              >
                Mở trang hồ sơ <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        }
        open={!!detailRecord}
        onClose={() => setDetailRecord(null)}
        width={720}
      >
        {detailRecord && (
          <div className="space-y-6">
            {detailRecord.sourceWarnings?.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message="Cảnh báo dữ liệu nguồn"
                description={
                  <ul className="list-disc list-inside text-xs space-y-1 mt-1">
                    {detailRecord.sourceWarnings.map(
                      (w: string, idx: number) => (
                        <li key={idx}>{w}</li>
                      ),
                    )}
                  </ul>
                }
              />
            )}

            {/* Thông tin nhân thân */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 border-b pb-1">
                1. Thông tin cá nhân &amp; Định danh
              </h4>
              <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
                <Descriptions.Item label="Họ và tên">
                  <strong>
                    {detailRecord.sourceValues?.["Họ và tên"] ||
                      detailRecord.fullName ||
                      "—"}
                  </strong>
                </Descriptions.Item>
                <Descriptions.Item label="Số CCCD">
                  <span className="font-mono">
                    {detailRecord.sourceValues?.["Số CCCD"] ||
                      detailRecord.idCard ||
                      "—"}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="Số điện thoại">
                  <span className="font-mono">
                    {detailRecord.sourceValues?.["SĐT"] ||
                      detailRecord.phone ||
                      "—"}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="Ngày sinh">
                  {formatDate(
                    detailRecord.sourceValues?.["Ngày sinh"] ||
                      detailRecord.dob,
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Giới tính">
                  {detailRecord.sourceValues?.["Giới tính"] ||
                    detailRecord.gender ||
                    "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Ngày cấp CCCD">
                  {formatDate(
                    detailRecord.sourceValues?.["Ngày cấp"] ||
                      detailRecord.idCardDate,
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Địa chỉ / Quê quán" span={2}>
                  {detailRecord.sourceValues?.["Địa chỉ"] ||
                    detailRecord.address ||
                    "—"}
                </Descriptions.Item>
              </Descriptions>
            </div>

            {/* Tuyển dụng & Đào tạo */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 border-b pb-1">
                2. Tuyển dụng &amp; Đào tạo
              </h4>
              <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
                <Descriptions.Item label="Nhà máy PV">
                  {detailRecord.sourceValues?.["Nhà máy PV"] || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Ngày phỏng vấn">
                  {formatDate(detailRecord.sourceValues?.["Ngày PV"])}
                </Descriptions.Item>
                <Descriptions.Item label="Chuyên viên tuyển dụng">
                  {detailRecord.sourceValues?.["Tuyển dụng"] || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Đón xe + KTX">
                  {detailRecord.sourceValues?.["Đón xe + KTX"] || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Tình trạng đào tạo">
                  {detailRecord.sourceValues?.["Tình trạng đào tạo"] || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Ngày ĐT dự kiến">
                  {formatDate(
                    detailRecord.sourceValues?.["Ngày Đào tạo dự kiến"],
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Ngày ĐT chuẩn" span={2}>
                  {formatDate(
                    detailRecord.sourceValues?.["Ngày đào tạo chuẩn"],
                  )}
                </Descriptions.Item>
              </Descriptions>
            </div>

            {/* Làm việc & Biến động */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 border-b pb-1">
                3. Quá trình làm việc &amp; Nghỉ việc
              </h4>
              <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
                <Descriptions.Item label="Nhà máy làm việc">
                  {detailRecord.sourceValues?.["Nhà máy làm việc"] || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Mã nhân viên">
                  <span className="font-mono">
                    {detailRecord.sourceValues?.["Mã NV"] || "—"}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="Loại hợp đồng">
                  {detailRecord.sourceValues?.["Loại HĐ"] ||
                    detailRecord.sourceValues?.["Loại HD"] ||
                    detailRecord.assignments?.[0]?.contractType ||
                    "—"}
                </Descriptions.Item>
                <Descriptions.Item label="Tháng nhận việc">
                  <span className="font-semibold">
                    {detailRecord.sourceValues?.["Tháng nhận việc"] || "—"}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="Tình trạng">
                  {getStatusTag(detailRecord.sourceValues?.["Tình trạng"])}
                </Descriptions.Item>
                <Descriptions.Item label="Ngày nghỉ việc (Ngày NH)">
                  <span className="text-rose-600 font-medium">
                    {formatDate(detailRecord.sourceValues?.["Ngày NH"])}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="Lý do nghỉ việc" span={2}>
                  {detailRecord.sourceValues?.["Lý do"] || "—"}
                </Descriptions.Item>
              </Descriptions>
            </div>

            {/* Dữ liệu Thưởng đối chiếu nếu có */}
            {detailRecord.rewardSource?.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 border-b pb-1">
                  4. Dữ liệu thưởng đối chiếu từ Excel (
                  {detailRecord.rewardSource.length} dòng)
                </h4>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="id"
                  dataSource={detailRecord.rewardSource}
                  columns={[
                    {
                      title: "Công ty",
                      dataIndex: ["values", "Công ty"],
                      key: "co",
                    },
                    {
                      title: "Ngày PV",
                      dataIndex: ["values", "Ngày PV"],
                      key: "pv",
                      render: (value: string) => formatDate(value),
                    },
                    {
                      title: "Chính sách",
                      dataIndex: ["values", "Chính sách"],
                      key: "po",
                    },
                    {
                      title: "Các mốc thưởng",
                      key: "bonuses",
                      render: (_: any, r: any) => {
                        const items = Array.from(
                          { length: 7 },
                          (_, i) => r.values?.[`Thưởng lần ${i + 1}`],
                        ).filter(Boolean);
                        return items.length ? items.join(" · ") : "—";
                      },
                    },
                  ]}
                />
              </div>
            )}

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 border-b pb-1">Lịch sử thay đổi</h4>
              {detailHistoryLoading ? <div className="text-slate-500">Đang tải lịch sử…</div> : detailRecord.reviewHistory?.length ? detailRecord.reviewHistory.map((entry: any) => (
                <div key={entry.id} className="mb-4 rounded-lg border p-3">
                  <div className="font-semibold">{new Date(entry.createdAt).toLocaleString("vi-VN")} · Người duyệt: {entry.reviewer}</div>
                  <div className="text-xs text-slate-500 mb-2">{entry.sourceFile} · Dòng {entry.sourceRow}</div>
                  {entry.changes.map((change: any) => <div key={change.key} className="py-1"><strong>{change.label}:</strong> {String(change.before ?? "") || "Trống"} → {String(change.after ?? "") || "Trống"}</div>)}
                  {!entry.changes.length && <div>Đã duyệt đối chiếu, thông tin không thay đổi.</div>}
                </div>
              )) : <div className="text-slate-500">Chưa có thay đổi được duyệt.</div>}
            </div>

            {/* Thao tác */}
            <div className="flex gap-2 pt-4 border-t">
              <Button
                type="primary"
                icon={<Edit3 className="w-4 h-4" />}
                onClick={() => {
                  handleOpenStatusModal(detailRecord);
                }}
              >
                Cập nhật trạng thái
              </Button>
              <Button
                icon={<Building className="w-4 h-4" />}
                onClick={() => {
                  handleOpenHistory(detailRecord);
                }}
              >
                Xem lịch sử công ty
              </Button>
            </div>
          </div>
        )}
      </Drawer>

      {/* Modal Lịch Sử Đa Công Ty */}
      <Modal
        title={
          <div className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-2">
              <Building className="w-5 h-5 text-blue-600" />
              <span className="text-base font-bold text-slate-900">
                Lịch sử làm việc đa công ty: {historyWorker?.fullName}
              </span>
            </div>
            <Tag color="blue" className="font-semibold text-xs">
              {historyWorker?.assignments?.length || 0} công ty từng làm
            </Tag>
          </div>
        }
        open={!!historyWorker}
        onCancel={() => setHistoryWorker(null)}
        footer={
          <div className="flex justify-between items-center pt-2">
            <span className="text-xs text-slate-500 font-mono">
              CCCD: {historyWorker?.idCard}
            </span>
            <div className="flex gap-2">
              <Button onClick={() => setHistoryWorker(null)}>Đóng</Button>
              <Button type="primary" href={`/workers/${historyWorker?.id}`}>
                Xem chi tiết hồ sơ &amp; mốc thưởng →
              </Button>
            </div>
          </div>
        }
        width={950}
      >
        <div className="space-y-4 my-2">
          <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-xs flex flex-wrap gap-4 text-slate-700">
            <span>
              Họ và tên:{" "}
              <strong className="text-slate-900">
                {historyWorker?.fullName}
              </strong>
            </span>
            <span>
              CCCD:{" "}
              <strong className="font-mono text-blue-800">
                {historyWorker?.idCard}
              </strong>
            </span>
            <span>
              SĐT:{" "}
              <strong className="font-mono text-slate-800">
                {historyWorker?.phone || "—"}
              </strong>
            </span>
            <span>
              Quê quán:{" "}
              <strong className="text-slate-800">
                {historyWorker?.province || "—"}
              </strong>
            </span>
          </div>

          <Table
            rowKey="id"
            loading={historyLoading}
            dataSource={historyWorker?.assignments || []}
            pagination={false}
            bordered
            size="small"
            locale={{
              emptyText:
                "Không có dòng phù hợp. Hãy kiểm tra bộ lọc hoặc chuyển nhóm hồ sơ.",
            }}
            columns={[
              {
                title: "STT",
                key: "idx",
                width: 50,
                align: "center" as const,
                render: (_: any, __: any, index: number) =>
                  (historyWorker?.assignments?.length || 0) - index,
              },
              {
                title: "Công Ty / Nhà Máy",
                key: "factory",
                render: (_: any, a: any) => (
                  <div>
                    <div className="font-bold text-slate-800">
                      {a.workingFactory || a.interviewFactory}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Đơn hàng: {a.order?.name || "Mặc định"}
                    </div>
                  </div>
                ),
              },
              {
                title: "Thời Gian Làm Việc",
                key: "timeline",
                render: (_: any, a: any) => (
                  <div className="text-xs">
                    <div>
                      PV/Bắt đầu:{" "}
                      <strong className="text-slate-700">
                        {formatDate(
                          a.startDate || a.passedDate || a.interviewDate,
                        )}
                      </strong>
                    </div>
                    {a.leaveDate && (
                      <div className="text-rose-600 font-medium">
                        Nghỉ: {formatDate(a.leaveDate)}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                title: "Tình Trạng & Lý Do Nghỉ",
                key: "status",
                render: (_: any, a: any) => (
                  <div>
                    <Tag
                      color={
                        a.status === "Đang làm việc"
                          ? "success"
                          : a.status === "Đã nghỉ việc"
                            ? "error"
                            : "default"
                      }
                    >
                      {a.status}
                    </Tag>
                    {a.leaveReason && (
                      <div className="text-[11px] text-rose-600 mt-1">
                        Lý do: {a.leaveReason}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                title: "Thưởng Đã Nhận",
                key: "bonus",
                render: (_: any, a: any) => {
                  const pTotal = (a.enrollments || []).reduce(
                    (sum: number, e: any) =>
                      sum +
                      (e.stages || []).reduce(
                        (sSum: number, s: any) =>
                          sSum +
                          (s.payments || []).reduce(
                            (pSum: number, p: any) => pSum + (p.amount || 0),
                            0,
                          ),
                        0,
                      ),
                    0,
                  );
                  const bTotal = (a.bonusRecords || []).reduce(
                    (sum: number, b: any) => sum + (b.totalBonus || 0),
                    0,
                  );
                  const total = pTotal > 0 ? pTotal : bTotal;
                  return total > 0 ? (
                    <span className="font-bold text-emerald-700 text-xs">
                      {total.toLocaleString("vi-VN")} đ
                    </span>
                  ) : (
                    <span className="text-slate-400 text-xs">—</span>
                  );
                },
              },
              {
                title: "Tuyển Dụng",
                dataIndex: "recruiter",
                key: "recruiter",
                render: (text: string) => (
                  <span className="text-xs text-slate-600">{text || "—"}</span>
                ),
              },
            ]}
          />
        </div>
      </Modal>

      {/* Modal Thêm Mới Hồ Sơ */}
      <Modal
        title={
          rehire
            ? "Tái tuyển dụng — giữ lịch sử hồ sơ"
            : "Thêm Mới Hồ Sơ Lao Động (DS_TONG)"
        }
        open={isAddModalOpen}
        onCancel={() => setIsAddModalOpen(false)}
        footer={null}
        width={700}
      >
        <Form
          form={addForm}
          layout="vertical"
          onFinish={handleAddWorker}
          initialValues={{
            interviewFactory: "Luxshare QC",
            contractType: "Thời vụ",
            status: "Đang chờ phỏng vấn",
          }}
          className="mt-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Form.Item
              name="fullName"
              label="Họ và Tên"
              rules={[{ required: true, message: "Vui lòng nhập Họ và Tên" }]}
            >
              <Input placeholder="Nguyễn Văn A" />
            </Form.Item>

            <Form.Item
              name="idCard"
              label="Số CCCD / CMT (Bắt buộc)"
              rules={[
                { required: true, message: "Vui lòng nhập số CCCD" },
                {
                  pattern: /^(\d{9}|\d{12})$/,
                  message: "CCCD 12 số hoặc CMT cũ 9 số",
                },
              ]}
              extra="Hệ thống tự động chặn trùng CCCD với toàn bộ dữ liệu cũ"
            >
              <Input readOnly={rehire} placeholder="Nhập đầy đủ số căn cước" />
            </Form.Item>

            <Form.Item name="phone" label="Số Điện Thoại">
              <Input placeholder="0987654321" />
            </Form.Item>

            <Form.Item name="dob" label="Ngày Sinh">
              <DateField />
            </Form.Item>

            <Form.Item name="gender" label="Giới Tính">
              <Select
                options={[
                  { label: "Nam", value: "Nam" },
                  { label: "Nữ", value: "Nữ" },
                ]}
              />
            </Form.Item>

            <Form.Item name="address" label="Địa Chỉ / Quê Quán">
              <Input placeholder="Diễn Châu, Nghệ An" />
            </Form.Item>

            <Form.Item name="interviewFactory" label="Nhà Máy Phỏng Vấn">
              <Select
                options={FACTORIES.map((f) => ({ label: f, value: f }))}
              />
            </Form.Item>

            <Form.Item name="status" label="Tình Trạng">
              <Select
                options={STATUSES.map((value) => ({ value, label: value }))}
              />
            </Form.Item>

            <Form.Item name="recruiter" label="Chuyên Viên Tuyển Dụng">
              <Input placeholder="Nguyễn Thu Trang" />
            </Form.Item>

            <Form.Item name="source" label="Nguồn Tuyển Dụng">
              <Input placeholder="Facebook, Zalo, Tự do..." />
            </Form.Item>

            <Form.Item name="standardTrainingDate" label="Ngày Đào Tạo Chuẩn">
              <DateField />
            </Form.Item>

            <Form.Item name="onboardingMonth" label="Tháng Nhận Việc">
              <Input placeholder="T10.2026" />
            </Form.Item>
            {[
              "code",
              "idCardDate",
              "idCardPlace",
              "province",
              "team",
              "workingFactory",
              "contractType",
              "shuttleBusKtx",
              "interviewDate",
              "expectedTrainingDate",
              "expectedTrainingStatus",
              "leaveDate",
              "leaveReason",
            ].map((name) => (
              <Form.Item
                key={name}
                name={name}
                label={
                  (
                    {
                      code: "Mã hồ sơ",
                      idCardDate: "Ngày cấp",
                      idCardPlace: "Nơi cấp",
                      province: "Tỉnh/Thành",
                      team: "Đội nhóm",
                      workingFactory: "Nhà máy làm việc",
                      contractType: "Loại hợp đồng",
                      shuttleBusKtx: "Đón xe / KTX",
                      interviewDate: "Ngày PV",
                      expectedTrainingDate: "Ngày đào tạo dự kiến",
                      expectedTrainingStatus: "Tình trạng đào tạo",
                      leaveDate: "Ngày nghỉ (nếu đã nghỉ)",
                      leaveReason: "Lý do nghỉ (nếu đã nghỉ)",
                    } as Record<string, string>
                  )[name]
                }
              >
                {DATE_FIELDS.has(name) ? <DateField /> : <Input />}
              </Form.Item>
            ))}
          </div>

          <AssignmentFields form={addForm} />
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button onClick={() => setIsAddModalOpen(false)}>Hủy</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              Lưu Hồ Sơ
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Modal Cập Nhật Trạng Thái & Báo Nghỉ Việc */}
      <Modal
        title={`Cập Nhật Trạng Thái: ${selectedWorker?.fullName}`}
        open={isStatusModalOpen}
        onCancel={() => setIsStatusModalOpen(false)}
        footer={null}
      >
        <Form
          form={statusForm}
          layout="vertical"
          onFinish={handleUpdateStatus}
          className="mt-4"
        >
          <AssignmentFields form={statusForm} showWorkDays />
          <div className="grid grid-cols-2 gap-3">
            {Object.entries({
              fullName: "Họ tên",
              phone: "SĐT",
              dob: "Ngày sinh",
              gender: "Giới tính",
              code: "Mã hồ sơ",
              idCardDate: "Ngày cấp",
              idCardPlace: "Nơi cấp",
              address: "Địa chỉ",
              province: "Tỉnh/Thành",
              team: "Đội nhóm",
              recruiter: "Tuyển dụng",
              source: "Nguồn",
              interviewFactory: "Nhà máy PV",
              workingFactory: "Nhà máy làm việc",
              contractType: "Loại hợp đồng",
              shuttleBusKtx: "Đón xe / KTX",
              interviewDate: "Ngày PV",
              expectedTrainingDate: "Ngày đào tạo dự kiến",
              expectedTrainingStatus: "Tình trạng đào tạo dự kiến",
              standardTrainingDate: "Ngày đào tạo chuẩn",
              onboardingMonth: "Tháng nhận việc",
            }).map(([name, label]) => (
              <Form.Item key={name} name={name} label={label}>
                {DATE_FIELDS.has(name) ? <DateField /> : <Input />}
              </Form.Item>
            ))}
          </div>
          <Form.Item name="status" label="Tình Trạng Làm Việc">
            <Select
              options={STATUSES.map((value) => ({ value, label: value }))}
            />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) =>
              prevValues.status !== currentValues.status
            }
          >
            {({ getFieldValue }) =>
              getFieldValue("status") === "Đã nghỉ việc" ? (
                <>
                  <Form.Item
                    name="leaveDate"
                    label="Ngày NH (Ngày Nghỉ Việc)"
                    rules={[
                      {
                        required: true,
                        message: "Vui lòng nhập Ngày nghỉ việc",
                      },
                    ]}
                    extra="Ghi nhận ngày làm việc cuối cùng tại xưởng"
                  >
                    <DateField />
                  </Form.Item>

                  <Form.Item
                    name="leaveReason"
                    label="Lý Do Nghỉ Việc"
                    rules={[
                      {
                        required: true,
                        message: "Vui lòng nhập lý do nghỉ việc",
                      },
                    ]}
                  >
                    <Select
                      options={[
                        { label: "Việc gia đình", value: "Việc gia đình" },
                        {
                          label: "Lương thưởng không phù hợp",
                          value: "Lương thưởng không phù hợp",
                        },
                        {
                          label: "Sức khỏe không đảm bảo",
                          value: "Sức khỏe không đảm bảo",
                        },
                        {
                          label: "Vi phạm kỷ luật / Tự ý bỏ việc",
                          value: "Vi phạm kỷ luật",
                        },
                        {
                          label: "Hết hạn hợp đồng",
                          value: "Hết hạn hợp đồng",
                        },
                        { label: "Khác", value: "Khác" },
                      ]}
                    />
                  </Form.Item>
                </>
              ) : null
            }
          </Form.Item>

          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button onClick={() => setIsStatusModalOpen(false)}>Đóng</Button>
            <Button type="primary" htmlType="submit">
              Xác Nhận Cập Nhật
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
