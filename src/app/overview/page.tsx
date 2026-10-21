"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import {
  Card,
  Table,
  Input,
  Select,
  Button,
  Statistic,
  Tabs,
  Space,
  Tag,
  Progress,
  Badge,
  message,
  Tooltip,
} from "antd";
import SourcePaidRowsTable from "./SourcePaidRowsTable";
import OverviewCharts from "@/components/OverviewCharts";
import DateField from "@/components/DateField";
import { formatDate } from "@/lib/date-format";
import Link from "next/link";
import {
  Calendar,
  Building2,
  Target,
  Filter,
  RotateCcw,
  Users,
  CheckCircle2,
  Briefcase,
  AlertCircle,
  Award,
  Coins,
  Clock,
  Search,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  ShieldAlert,
  TrendingUp,
  HelpCircle,
  Info,
  ChevronRight,
} from "lucide-react";

const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
const money = (n: number) => (n || 0).toLocaleString("vi-VN") + " ₫";

export default function OverviewPage() {
  const [data, setData] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [catalogs, setCatalogs] = useState<any[]>([]);

  // Đổi kiểu dữ liệu sang Record<string, any> để chấp nhận mảng string[]
  const [filters, setFilters] = useState<Record<string, any>>({
    month: "",
    from: "",
    to: "",
    interviewFactory: [], // Mảng multi-select
    orderId: [], // Mảng multi-select
    batchId: [], // Mảng multi-select
  });

  const [busy, setBusy] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<Record<string, unknown>>({});
  const reportRequest = useRef<AbortController | null>(null);

  async function load() {
    reportRequest.current?.abort();
    const controller = new AbortController(); reportRequest.current = controller;
    setBusy(true);
    try {
      const params = new URLSearchParams();

      // Duyệt qua từng key trong filters để build URLSearchParams chuẩn
      Object.entries(filters).forEach(([key, val]) => {
        if (Array.isArray(val)) {
          if (val.length > 0) {
            params.append(key, val.join(","));
          }
        } else if (val !== undefined && val !== null && val !== "") {
          params.append(key, String(val));
        }
      });

      params.set("view", "overview");
      const res = await fetch(`/api/reports?${params.toString()}`, { signal: controller.signal, cache: "no-store" });
      const j = await res.json();
      if (controller.signal.aborted) return;

      if (j.success) {
        setData(j.data);
        setAppliedFilters(filters);
      } else {
        message.error(j.message || "Không tải được báo cáo");
      }
    } catch {
      if (!controller.signal.aborted) message.error("Lỗi khi tải dữ liệu báo cáo");
    } finally {
      if (reportRequest.current === controller) setBusy(false);
    }
  }

  useEffect(() => {
    load();
    Promise.all([
      fetch("/api/orders").then((r) => r.json()),
      fetch("/api/catalogs").then((r) => r.json()),
    ])
      .then(([o, c]) => {
        setOrders(o.data || []);
        setCatalogs(c.data || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setInterval(() => load(), 60000);
    return () => clearInterval(timer);
  }, [filters]);

  useEffect(() => () => { reportRequest.current?.abort(); }, []);

  // 1. Cập nhật hàm set để nhận cả string và mảng string[]
  const set = (key: string, value: any) =>
    setFilters((old) => ({ ...old, [key]: value ?? "" }));

  // 2. Cập nhật hàm clearFilters để reset về mảng rỗng cho các trường multi-select
  const clearFilters = () =>
    setFilters({
      month: "",
      from: "",
      to: "",
      interviewFactory: [],
      orderId: [],
      batchId: [],
    });

  const factoryNames = [
    ...new Set([
      ...orders.map((o) => o.factory),
      ...catalogs.map((c: any) => c.name),
    ]),
  ].filter(Boolean);

  // Active filters list for display
  const activeFilterList = useMemo(() => {
    const list: { key: string; label: string; value: string }[] = [];
    if (filters.month)
      list.push({ key: "month", label: "Tháng PV", value: filters.month });
    if (filters.from)
      list.push({
        key: "from",
        label: "Từ ngày",
        value: formatDate(filters.from),
      });
    if (filters.to)
      list.push({
        key: "to",
        label: "Đến ngày",
        value: formatDate(filters.to),
      });
    if (
      Array.isArray(filters.interviewFactory)
        ? filters.interviewFactory.length > 0
        : Boolean(filters.interviewFactory)
    )
      list.push({
        key: "interviewFactory",
        label: "Nhà máy",
        value: Array.isArray(filters.interviewFactory)
          ? filters.interviewFactory.join(", ")
          : String(filters.interviewFactory),
      });
    if (
      Array.isArray(filters.orderId)
        ? filters.orderId.length > 0
        : Boolean(filters.orderId)
    ) {
      const selectedOrderIds = Array.isArray(filters.orderId)
        ? filters.orderId
        : [filters.orderId];
      const names = selectedOrderIds.map((id) => {
        const o = orders.find((ord) => ord.id === id);
        return o ? o.name : id;
      });
      list.push({
        key: "orderId",
        label: "Đơn hàng",
        value: names.join(", "),
      });
    }
    if (
      Array.isArray(filters.batchId)
        ? filters.batchId.length > 0
        : Boolean(filters.batchId)
    ) {
      list.push({
        key: "batchId",
        label: "Đợt tuyển",
        value: Array.isArray(filters.batchId)
          ? filters.batchId.join(", ")
          : String(filters.batchId),
      });
    }
    return list;
  }, [filters, orders]);

  // Recruitment columns for full table
  const recruitColumns = [
    {
      title: "Nhóm / Phân loại",
      dataIndex: "name",
      key: "name",
      width: 180,
      render: (text: string) => (
        <strong className="text-slate-800">{text}</strong>
      ),
    },
    {
      title: "Lượt tuyển",
      dataIndex: "total",
      key: "total",
      width: 100,
      sorter: (a: any, b: any) => (a.total || 0) - (b.total || 0),
      render: (n: number) => (
        <span className="font-semibold text-slate-900">{n || 0}</span>
      ),
    },
    {
      title: "Số người",
      dataIndex: "people",
      key: "people",
      width: 90,
      render: (n: number) => <span className="text-slate-600">{n || 0}</span>,
    },
    {
      title: "Đỗ PV",
      dataIndex: "passed",
      key: "passed",
      width: 90,
      sorter: (a: any, b: any) => (a.passed || 0) - (b.passed || 0),
      render: (n: number) => (
        <span className="font-semibold text-emerald-600">{n || 0}</span>
      ),
    },
    {
      title: "Tỷ lệ đỗ",
      dataIndex: "passRate",
      key: "passRate",
      width: 140,
      sorter: (a: any, b: any) => (a.passRate || 0) - (b.passRate || 0),
      render: (rate: number | null) => (
        <div className="flex items-center gap-2">
          <Progress
            percent={rate || 0}
            size="small"
            showInfo={false}
            strokeColor={
              rate && rate >= 80
                ? "#16a34a"
                : rate && rate >= 50
                  ? "#3b82f6"
                  : "#f59e0b"
            }
            className="w-16"
          />
          <span className="text-xs font-semibold">{pct(rate)}</span>
        </div>
      ),
    },
    {
      title: "Đang làm việc",
      dataIndex: "working",
      key: "working",
      width: 110,
      sorter: (a: any, b: any) => (a.working || 0) - (b.working || 0),
      render: (n: number) => <Tag color="blue">{n || 0} người</Tag>,
    },
    {
      title: "Trượt PV",
      dataIndex: "failed",
      key: "failed",
      width: 90,
      render: (n: number) =>
        n ? (
          <Tag color="error">{n}</Tag>
        ) : (
          <span className="text-slate-400">0</span>
        ),
    },
    {
      title: "Bỏ PV",
      dataIndex: "abandoned",
      key: "abandoned",
      width: 80,
      render: (n: number) =>
        n ? (
          <Tag color="warning">{n}</Tag>
        ) : (
          <span className="text-slate-400">0</span>
        ),
    },
    {
      title: "Quay lại",
      dataIndex: "returning",
      key: "returning",
      width: 90,
      render: (n: number) =>
        n ? (
          <Tag color="cyan">{n}</Tag>
        ) : (
          <span className="text-slate-400">0</span>
        ),
    },
    {
      title: "Chi tiết tình trạng",
      dataIndex: "statusCounts",
      key: "statusCounts",
      render: (counts: Record<string, number>) => (
        <div className="flex flex-wrap gap-1">
          {Object.entries(counts || {}).map(([sName, count]) => (
            <Tag key={sName} className="text-[11px] mb-1">
              {sName}: <strong>{count}</strong>
            </Tag>
          ))}
        </div>
      ),
    },
  ];

  // Reward columns for full table
  const rewardColumns = [
    {
      title: "Nhóm / Đơn vị",
      dataIndex: "name",
      key: "name",
      width: 200,
      render: (text: string) => (
        <strong className="text-slate-800">{text}</strong>
      ),
    },
    {
      title: "Hồ sơ áp dụng",
      dataIndex: "applications",
      key: "applications",
      width: 110,
      sorter: (a: any, b: any) => (a.applications || 0) - (b.applications || 0),
      render: (n: number) => (
        <span className="font-semibold text-slate-800">{n || 0}</span>
      ),
    },
    {
      title: "Đủ điều kiện",
      dataIndex: "eligible",
      key: "eligible",
      width: 100,
      render: (n: number) => <span className="text-slate-600">{n || 0}</span>,
    },
    {
      title: "Đạt mốc",
      dataIndex: "achieved",
      key: "achieved",
      width: 90,
      render: (n: number) => (
        <span className="font-bold text-emerald-600">{n || 0}</span>
      ),
    },
    {
      title: "Tỷ lệ đạt",
      dataIndex: "achieveRate",
      key: "achieveRate",
      width: 130,
      sorter: (a: any, b: any) => (a.achieveRate || 0) - (b.achieveRate || 0),
      render: (rate: number | null) => (
        <div className="flex items-center gap-2">
          <Progress
            percent={rate || 0}
            size="small"
            showInfo={false}
            strokeColor={rate && rate >= 80 ? "#16a34a" : "#3b82f6"}
            className="w-16"
          />
          <span className="text-xs font-semibold">{pct(rate)}</span>
        </div>
      ),
    },
    {
      title: "Tiền đạt mốc",
      dataIndex: "earned",
      key: "earned",
      width: 140,
      sorter: (a: any, b: any) => (a.earned || 0) - (b.earned || 0),
      render: (n: number) => (
        <span className="font-bold text-purple-700">{money(n)}</span>
      ),
    },
    {
      title: "Thực tế đã trả",
      dataIndex: "paid",
      key: "paid",
      width: 140,
      sorter: (a: any, b: any) => (a.paid || 0) - (b.paid || 0),
      render: (n: number) => (
        <span className="font-bold text-emerald-700">{money(n)}</span>
      ),
    },
    {
      title: "Còn phải trả",
      dataIndex: "outstanding",
      key: "outstanding",
      width: 140,
      sorter: (a: any, b: any) => (a.outstanding || 0) - (b.outstanding || 0),
      render: (n: number) =>
        n > 0 ? (
          <span className="font-bold text-amber-700">{money(n)}</span>
        ) : (
          <span className="text-slate-400">0 ₫</span>
        ),
    },
  ];

  // Helper render full-featured responsive table
  const renderTable = (rows: any[], columns: any[]) => {
    const filteredRows = tableSearch.trim()
      ? (rows || []).filter((r) =>
          String(r.name || "")
            .toLowerCase()
            .includes(tableSearch.toLowerCase()),
        )
      : rows || [];

    return (
      <Table<any>
        size="middle"
        className="overview-table"
        rowKey={(r, i) => r.id || `${r.name}-${i}`}
        loading={busy}
        dataSource={filteredRows}
        columns={columns}
        scroll={{ x: "max-content" }}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total, range) =>
            `${range[0]}–${range[1]} / ${total} bản ghi`,
        }}
      />
    );
  };

  const recSummary = data?.recruitment?.summary || {};
  const rewSummary = data?.rewards?.summary || {};
  const sourcePaid = data?.sourcePaid;

  const totalRecruits = recSummary.total || 0;
  const passedCount = recSummary.passed || 0;
  const passRate =
    recSummary.passRate ??
    (totalRecruits ? Math.round((passedCount / totalRecruits) * 100) : 0);
  const workingCount = recSummary.working || 0;
  const workingRate = passedCount
    ? Math.round((workingCount / passedCount) * 100)
    : 0;
  const returningCount = recSummary.returning || 0;
  const returnRate = recSummary.returnRate ?? 0;
  const failedCount = recSummary.failed || 0;
  const abandonedCount = recSummary.abandoned || 0;
  const unknownInterview = recSummary.unknownInterview || 0;

  // ĐỒNG BỘ DÒNG TIỀN THƯỞNG:
  // Nếu công ty có số tiền thực tế đã chi trả từ file nguồn DS_THUONG (sourcePaid.total),
  // tổng hợp đầy đủ số tiền thực tế đã trả của cả nguồn Excel và phiếu chi nội bộ!
  const sourcePaidMoney = sourcePaid?.total || 0;
  const internalPaidMoney = rewSummary.paid || 0;
  const paidMoney =
    sourcePaidMoney > 0
      ? sourcePaidMoney + internalPaidMoney
      : internalPaidMoney;
  const earnedMoney = rewSummary.earned > 0 ? rewSummary.earned : paidMoney;
  const outstandingMoney =
    rewSummary.outstanding > 0 ? rewSummary.outstanding : 0;
  const payRate =
    earnedMoney > 0
      ? Math.min(100, Math.round((paidMoney / earnedMoney) * 100))
      : 100;

  return (
    <div className="overview-page min-w-0 space-y-6 pb-12">
      {/* 1. HEADER EXECUTIVE BANNER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-md">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-400/30">
              TRUNG TÂM ĐIỀU HÀNH
            </span>
            <span className="text-xs text-slate-400">
              Cập nhật tự động · Phỏng vấn & Thưởng
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white m-0">
            Tổng Quan Tuyển Dụng & Vận Hành Lao Động
          </h1>
          <p className="text-xs md:text-sm text-slate-300 mt-1 max-w-2xl m-0">
            Giám sát toàn diện phễu ứng viên, kết quả phỏng vấn các nhà máy và
            tiến độ giải ngân dòng tiền thưởng
          </p>
        </div>

        {/* Quick Navigation Links */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="primary"
            onClick={load}
            loading={busy}
            icon={<RotateCcw className="w-4 h-4" />}
            className="bg-blue-600 hover:bg-blue-500 font-semibold border-none"
          >
            Làm Mới
          </Button>
          <Link href="/bonuses">
            <Button
              className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border-amber-400/40 hover:border-amber-400/60 font-semibold"
              icon={<Coins className="w-4 h-4 text-amber-300" />}
            >
              Quản Lý Thưởng (DS_THUONG)
            </Button>
          </Link>
          <Link href="/excel-tools">
            <Button
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 hover:border-white/40"
              icon={<FileSpreadsheet className="w-4 h-4" />}
            >
              Nhập Excel
            </Button>
          </Link>
          <Link href="/workers">
            <Button
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 hover:border-white/40"
              icon={<FileText className="w-4 h-4" />}
            >
              Hồ Sơ (DS_TONG)
            </Button>
          </Link>
          <Link href="/lookup">
            <Button
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 hover:border-white/40"
              icon={<Fingerprint className="w-4 h-4" />}
            >
              Tra Cứu CCCD
            </Button>
          </Link>
        </div>
      </div>

      {/* 2. BỘ LỌC TỔNG QUÁT CẤP CAO (EXECUTIVE FILTERS) */}
      <Card className="shadow-xs border-slate-200/90 rounded-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-blue-600" />
            <span className="font-bold text-sm text-slate-800">
              Bộ Lọc Phân Tích Đa Chiều
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 hidden sm:inline">
              Mốc thời gian tính theo ngày phỏng vấn (PV)
            </span>
            <Button
              size="small"
              onClick={clearFilters}
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              disabled={activeFilterList.length === 0}
            >
              Xóa Bộ Lọc
            </Button>
            <Button
              type="primary"
              size="small"
              loading={busy}
              onClick={load}
              icon={<Filter className="w-3.5 h-3.5" />}
              className="bg-blue-600 hover:bg-blue-700 font-medium"
            >
              Áp Dụng
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mt-4 items-start">
          {/* 1. Tháng PV */}
          <div>
            <label
              htmlFor="filter-month"
              className="block text-xs font-semibold text-slate-600 mb-1.5"
            >
              Tháng phỏng vấn
            </label>
            <Input
              id="filter-month"
              type="month"
              value={filters.month || ""}
              onChange={(e) => set("month", e.target.value)}
              className="w-full rounded-lg"
              placeholder="Chọn tháng"
            />
          </div>

          {/* 2. Từ ngày */}
          <div>
            <label
              htmlFor="filter-from"
              className="block text-xs font-semibold text-slate-600 mb-1.5"
            >
              Từ ngày PV
            </label>
            <DateField
              id="filter-from"
              value={filters.from || ""}
              onChange={(value) => set("from", value)}
              className="w-full rounded-lg"
            />
          </div>

          {/* 3. Đến ngày */}
          <div>
            <label
              htmlFor="filter-to"
              className="block text-xs font-semibold text-slate-600 mb-1.5"
            >
              Đến ngày PV
            </label>
            <DateField
              id="filter-to"
              value={filters.to || ""}
              onChange={(value) => set("to", value)}
              className="w-full rounded-lg"
            />
          </div>

          {/* 4. Nhà máy (Hỗ trợ Multi-Select + Chọn tất cả) */}
          <div>
            <label
              htmlFor="filter-factory"
              className="block text-xs font-semibold text-slate-600 mb-1.5"
            >
              Nhà máy phỏng vấn (Chọn nhiều)
            </label>
            <Select
              id="filter-factory"
              mode="multiple"
              maxTagCount="responsive"
              className="w-full"
              allowClear
              placeholder="Tất cả nhà máy"
              value={
                Array.isArray(filters.interviewFactory)
                  ? filters.interviewFactory
                  : []
              }
              onChange={(selectedValues) => {
                const allList = factoryNames || [];
                if (selectedValues.includes("ALL")) {
                  const currentList = Array.isArray(filters.interviewFactory)
                    ? filters.interviewFactory
                    : [];
                  if (currentList.length === allList.length) {
                    set("interviewFactory", []);
                  } else {
                    set("interviewFactory", allList);
                  }
                } else {
                  set("interviewFactory", selectedValues);
                }
              }}
              options={[
                { value: "ALL", label: "--- Chọn tất cả ---" },
                ...(factoryNames || []).map((f) => ({ value: f, label: f })),
              ]}
            />
          </div>

          {/* 5. Đơn hàng (Hỗ trợ Multi-Select + Chọn tất cả) */}
          <div>
            <label
              htmlFor="filter-order"
              className="block text-xs font-semibold text-slate-600 mb-1.5"
            >
              Đơn hàng tuyển dụng (Chọn nhiều)
            </label>
            <Select
              id="filter-order"
              mode="multiple"
              maxTagCount="responsive"
              className="w-full"
              allowClear
              popupMatchSelectWidth={false}
              placeholder="Tất cả đơn hàng"
              value={Array.isArray(filters.orderId) ? filters.orderId : []}
              onChange={(selectedValues) => {
                const allList = orders.map((o) => o.id);
                if (selectedValues.includes("ALL")) {
                  const currentList = Array.isArray(filters.orderId)
                    ? filters.orderId
                    : [];
                  if (currentList.length === allList.length) {
                    set("orderId", []);
                  } else {
                    set("orderId", allList);
                  }
                } else {
                  set("orderId", selectedValues);
                }
                set("batchId", []); // Reset đợt tuyển khi đổi đơn hàng
              }}
              options={[
                { value: "ALL", label: "--- Chọn tất cả ---" },
                ...orders.map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
          </div>
        </div>

        {/* Hàng phụ: Đợt tuyển & Active Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-2 max-w-xl w-full">
            <span className="text-xs font-semibold text-slate-600 shrink-0">
              Đợt tuyển (Chọn nhiều):
            </span>
            <Select
              id="filter-batch"
              mode="multiple"
              maxTagCount="responsive"
              className="w-full"
              allowClear
              popupMatchSelectWidth={false}
              placeholder="Tất cả đợt tuyển (T01 - T10)"
              value={Array.isArray(filters.batchId) ? filters.batchId : []}
              onChange={(selectedValues) => {
                const selectedFactories = Array.isArray(
                  filters.interviewFactory,
                )
                  ? filters.interviewFactory
                  : [];
                const selectedOrders = Array.isArray(filters.orderId)
                  ? filters.orderId
                  : [];
                const availablePeriods = Array.from(
                  new Set(
                    orders
                      .filter(
                        (o) =>
                          (selectedFactories.length === 0 ||
                            selectedFactories.includes(o.factory)) &&
                          (selectedOrders.length === 0 ||
                            selectedOrders.includes(o.id)),
                      )
                      .flatMap((o) =>
                        (o.batches || []).map(
                          (b: any) => b.periodMonth || b.name,
                        ),
                      )
                      .filter(Boolean),
                  ),
                );

                if (selectedValues.includes("ALL")) {
                  const currentList = Array.isArray(filters.batchId)
                    ? filters.batchId
                    : [];
                  if (currentList.length === availablePeriods.length) {
                    set("batchId", []);
                  } else {
                    set("batchId", availablePeriods);
                  }
                } else {
                  set("batchId", selectedValues);
                }
              }}
              options={(() => {
                const selectedFactories = Array.isArray(
                  filters.interviewFactory,
                )
                  ? filters.interviewFactory
                  : [];
                const selectedOrders = Array.isArray(filters.orderId)
                  ? filters.orderId
                  : [];
                const matchingOrders = orders.filter(
                  (o) =>
                    (selectedFactories.length === 0 ||
                      selectedFactories.includes(o.factory)) &&
                    (selectedOrders.length === 0 ||
                      selectedOrders.includes(o.id)),
                );
                const periodMap = new Map<
                  string,
                  { period: string; target: number; count: number }
                >();
                for (const o of matchingOrders) {
                  for (const b of o.batches || []) {
                    const period = String(b.periodMonth || b.name || "").trim();
                    if (!period) continue;
                    const cur = periodMap.get(period) || {
                      period,
                      target: 0,
                      count: 0,
                    };
                    if (b.target) cur.target += Number(b.target);
                    cur.count += 1;
                    periodMap.set(period, cur);
                  }
                }
                const batchOptions = Array.from(periodMap.values())
                  .sort((a, b) =>
                    a.period.localeCompare(b.period, "vi", { numeric: true }),
                  )
                  .map((item) => ({
                    value: item.period,
                    label:
                      matchingOrders.length === 1 && item.target > 0
                        ? `Đợt ${item.period} (Chỉ tiêu: ${item.target.toLocaleString("vi-VN")})`
                        : `Đợt ${item.period}`,
                  }));
                return [
                  { value: "ALL", label: "--- Chọn tất cả ---" },
                  ...batchOptions,
                ];
              })()}
            />
          </div>

          {/* Active filter chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {activeFilterList.length === 0 ? (
              <span className="text-xs text-slate-400 italic">
                Đang hiển thị toàn bộ thời gian & đơn vị
              </span>
            ) : (
              activeFilterList.map((f) => (
                <Tag
                  key={f.key}
                  closable
                  onClose={() =>
                    set(f.key, Array.isArray(filters[f.key]) ? [] : "")
                  }
                  color="blue"
                  className="text-xs py-0.5 px-2 rounded-md"
                >
                  {f.label}: <strong>{f.value}</strong>
                </Tag>
              ))
            )}
          </div>
        </div>
      </Card>

      {/* 3. KHUNG CHỈ SỐ KPI VĨ MÔ (HERO EXECUTIVE CARDS) */}
      {data && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800 m-0 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Chỉ Số Trọng Yếu Tuyển Dụng & Tài Chính
            </h2>
            <span className="text-xs text-slate-500">
              Dữ liệu tổng hợp theo bộ lọc đang kích hoạt
            </span>
          </div>

          {/* NHÓM A: TUYỂN DỤNG & NHÂN SỰ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* 1. Tổng lượt tuyển */}
            <div className="p-4 rounded-xl bg-white border border-blue-100 shadow-xs hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-500">
                  Tổng Lượt Tuyển
                </span>
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-blue-600 tracking-tight">
                {totalRecruits.toLocaleString("vi-VN")}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Gồm{" "}
                <strong className="text-slate-800">
                  {recSummary.people || 0}
                </strong>{" "}
                người lao động
              </div>
            </div>

            {/* 2. Đỗ Phỏng Vấn */}
            <div className="p-4 rounded-xl bg-white border border-emerald-100 shadow-xs hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-500">
                  Đỗ Phỏng Vấn (PASS)
                </span>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-emerald-600 tracking-tight">
                {passedCount.toLocaleString("vi-VN")}
              </div>
              <div className="mt-1 text-xs text-slate-500 flex items-center gap-1">
                <Tag color="green" className="text-[11px] font-semibold m-0">
                  {passRate}% Đỗ
                </Tag>
                <span>/ {totalRecruits.toLocaleString("vi-VN")} lượt</span>
              </div>
            </div>

            {/* 3. Đang Làm Việc */}
            <div className="p-4 rounded-xl bg-white border border-indigo-100 shadow-xs hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-500">
                  Đang Làm Việc
                </span>
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Briefcase className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-indigo-600 tracking-tight">
                {workingCount.toLocaleString("vi-VN")}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                <Tag color="indigo" className="text-[11px] font-semibold m-0">
                  {workingRate}%
                </Tag>
                <span className="ml-1">chuyển đổi sau PV</span>
              </div>
            </div>

            {/* 4. Trượt / Bỏ / Chưa rõ */}
            <div className="p-4 rounded-xl bg-white border border-amber-100 shadow-xs hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-500">
                  Trượt / Bỏ / Chưa rõ
                </span>
                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                  <AlertCircle className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-amber-600 tracking-tight">
                {(
                  failedCount +
                  abandonedCount +
                  unknownInterview
                ).toLocaleString("vi-VN")}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Trượt: <strong>{failedCount}</strong> · Bỏ:{" "}
                <strong>{abandonedCount.toLocaleString("vi-VN")}</strong> · Chưa
                rõ: <strong>{unknownInterview}</strong>
              </div>
            </div>

            {/* 5. Lao Động Quay Lại */}
            <Link
              href="/workers?returning=true"
              className="block p-4 rounded-xl bg-white border border-cyan-100 shadow-xs hover:shadow-md transition-all group cursor-pointer"
              title="Bấm để xem danh sách người lao động tái ký / quay lại"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-500 group-hover:text-cyan-700 transition">
                  Lao Động Quay Lại
                </span>
                <div className="w-8 h-8 rounded-lg bg-cyan-50 group-hover:bg-cyan-100 text-cyan-600 flex items-center justify-center transition">
                  <RotateCcw className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-cyan-600 tracking-tight">
                {returningCount.toLocaleString("vi-VN")}
              </div>
              <div className="mt-1 text-xs text-slate-500 flex items-center gap-1">
                <Tag color="cyan" className="text-[11px] font-semibold m-0">
                  {returnRate}%
                </Tag>
                <span>tỷ lệ tái ký (Bấm xem DS)</span>
              </div>
            </Link>
          </div>

          {/* NHÓM B: TÀI CHÍNH & DÒNG TIỀN THƯỞNG (ĐÃ ĐỒNG BỘ NGUỒN EXCEL) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-2 mb-2">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-amber-600" />
              <span>Tài chính & Dòng tiền thưởng (Theo DS_THUONG)</span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/bonuses"
                className="text-xs font-semibold text-amber-700 hover:text-amber-800 flex items-center gap-1 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-lg border border-amber-200 transition"
              >
                <Coins className="w-3.5 h-3.5 text-amber-600" />
                <span>Mở Quản Lý Thưởng (DS_THUONG)</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
              <Link
                href="/rewards"
                className="text-xs font-semibold text-purple-700 hover:text-purple-800 flex items-center gap-1 bg-purple-50 hover:bg-purple-100 px-2.5 py-1 rounded-lg border border-purple-200 transition"
              >
                <Award className="w-3.5 h-3.5 text-purple-600" />
                <span>Mốc thưởng / Đã trả</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Tiền Đạt Mốc */}
            <Link href="/rewards" className="block group">
              <div className="p-4 rounded-xl bg-white border border-purple-100 shadow-xs group-hover:border-purple-300 group-hover:shadow-md transition-all h-full flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-500 group-hover:text-purple-700 transition">
                      Tiền Đạt Mốc Thưởng
                    </span>
                    <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition">
                      <Award className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="text-2xl font-black text-purple-700 tracking-tight">
                    {money(earnedMoney)}
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
                  {rewSummary.achieved > 0 ? (
                    <span>
                      {rewSummary.achieved} / {rewSummary.eligible} mốc đạt tiêu
                      chuẩn ({pct(rewSummary.achieveRate)})
                    </span>
                  ) : (
                    <span className="text-purple-600 font-medium">
                      Hạch toán từ{" "}
                      {(sourcePaid?.rowCount ?? sourcePaid?.rows?.length ?? 0).toLocaleString("vi-VN")}{" "}
                      lượt chi thưởng DS_THUONG
                    </span>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-purple-600 transition" />
                </div>
              </div>
            </Link>

            {/* Thực Tế Đã Chi Trả */}
            <Link href="/bonuses" className="block group">
              <div className="p-4 rounded-xl bg-white border border-emerald-100 shadow-xs group-hover:border-emerald-300 group-hover:shadow-md transition-all h-full flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-500 group-hover:text-emerald-700 transition">
                      Thực Tế Đã Chi Trả
                    </span>
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition">
                      <Coins className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="text-2xl font-black text-emerald-700 tracking-tight">
                    {money(paidMoney)}
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Tag color="green" className="text-[11px] font-semibold m-0">
                      {payRate}% Đã giải ngân
                    </Tag>
                    {sourcePaidMoney > 0 && (
                      <span className="text-emerald-700 font-medium">
                        (Đồng bộ file DS_THUONG)
                      </span>
                    )}
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition" />
                </div>
              </div>
            </Link>

            {/* Còn Phải Trả */}
            <Link href="/rewards" className="block group">
              <div className="p-4 rounded-xl bg-white border border-amber-100 shadow-xs group-hover:border-amber-300 group-hover:shadow-md transition-all h-full flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-500 group-hover:text-amber-700 transition">
                      Dư Nợ Còn Phải Trả
                    </span>
                    <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition">
                      <Clock className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="text-2xl font-black text-amber-700 tracking-tight">
                    {money(outstandingMoney)}
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
                  {outstandingMoney > 0 ? (
                    <span className="text-amber-600 font-medium">
                      Cần chuẩn bị kế hoạch thanh toán
                    </span>
                  ) : (
                    <span className="text-slate-400">Không có dư nợ quá hạn</span>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-amber-600 transition" />
                </div>
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* 4. ĐỐI CHIẾU NGUỒN EXCEL (CHỈ HIỂN THỊ KHI CÓ DỮ LIỆU NGUỒN) */}
      {sourcePaid &&
        (sourcePaid.total > 0 || (sourcePaid.rowCount ?? sourcePaid.rows?.length ?? 0) > 0) && (
          <Card
            title={
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1">
                <div className="flex items-center gap-2">
                  <Coins className="w-5 h-5 text-amber-600" />
                  <div>
                    <span className="font-bold text-base text-slate-800">
                      Đối Chiếu Chi Thưởng Thực Tế Theo File DS_THUONG Gốc
                    </span>
                    <span className="text-xs text-slate-500 block font-normal">
                      Số liệu giải ngân các lần thưởng 1 → 7 nạp trực tiếp từ
                      bảng tính của công ty
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Tag
                    color="cyan"
                    className="text-sm font-bold px-3 py-1 rounded-lg"
                  >
                    Tổng tiền đã chi: {money(sourcePaid.total)}
                  </Tag>
                  <Link
                    href="/bonuses"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs transition"
                  >
                    <Coins className="w-3.5 h-3.5" />
                    <span>Mở Quản Lý Thưởng (DS_THUONG)</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            }
            className="border-slate-200 shadow-xs rounded-2xl"
          >
            {/* Hộp giải thích rõ ràng, thân thiện cho người dùng */}
            <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3.5 mb-4 text-xs space-y-2">
              <div className="font-bold text-blue-900 flex items-center gap-1.5 text-sm">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                Toàn bộ số tiền thưởng {money(sourcePaid.total)} đã được ghi nhận và đồng bộ đầy đủ vào hệ thống
              </div>
              <p className="text-slate-600 m-0 leading-relaxed">
                • <b>Số lượt nhận thưởng</b>: Tổng số lượt chi thưởng tương ứng với các lao động nhận thưởng tại từng nhà máy.
                <br />• <b>Thực tế đã chi trả</b>: Toàn bộ số tiền thưởng đã được hạch toán đầy đủ và chính xác cho người lao động.
              </p>
              <div className="pt-2 border-t border-blue-200/70 flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-600">
                  👉 Xem danh sách chi tiết từng lao động, trạng thái tài khoản ngân hàng hoặc xuất lệnh chi tiền thưởng:
                </span>
                <Link
                  href="/bonuses"
                  className="inline-flex items-center gap-1 font-bold text-blue-700 hover:text-blue-900 bg-white hover:bg-blue-50 px-2.5 py-1 rounded-md border border-blue-300 transition"
                >
                  <Coins className="w-3.5 h-3.5 text-amber-600" />
                  <span>Đi đến Trang Quản lý Thưởng</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </div>

            <Tabs
              items={[
                {
                  key: "sourceCompanies",
                  label: `Tổng Hợp Theo Nhà Máy (${sourcePaid.companies?.length || 0} công ty)`,
                  children: renderTable(sourcePaid.companies, [
                    {
                      title: "Công ty / Nhà máy",
                      dataIndex: "name",
                      key: "name",
                      render: (t: string) => (
                        <strong className="text-slate-800">{t}</strong>
                      ),
                    },
                    {
                      title: "Số lượt nhận thưởng",
                      dataIndex: "rows",
                      key: "rows",
                      render: (n: number) => (
                        <span className="font-semibold text-slate-800">
                          {n.toLocaleString("vi-VN")} lượt
                        </span>
                      ),
                    },
                    {
                      title: "Thực tế đã chi trả",
                      dataIndex: "paid",
                      key: "paid",
                      render: (n: number) => (
                        <strong className="text-emerald-700">{money(n)}</strong>
                      ),
                    },
                    {
                      title: "Cần kiểm tra số tiền",
                      dataIndex: "pending",
                      key: "pending",
                      render: (n: number) =>
                        n > 0 ? (
                          <Tag color="error">{n} dòng</Tag>
                        ) : (
                          <Tag color="cyan">Hợp lệ 100%</Tag>
                        ),
                    },
                  ]),
                },
                {
                  key: "sourceRows",
                  label: `Danh Sách Chi Tiết Từng Lượt Nhận Thưởng (${sourcePaid.rowCount ?? sourcePaid.rows?.length ?? 0})`,
                  children: <SourcePaidRowsTable filters={appliedFilters} search={tableSearch} />,
                },
              ]}
            />
          </Card>
        )}

      {/* 5. PHỄU & ĐỒ THỊ TRỰC QUAN HÓA (VISUAL ANALYTICS) */}
      {data && <OverviewCharts data={data} />}

      {/* 6. BẢNG TỔNG HỢP SỐ LIỆU VĨ MÔ CHI TIẾT */}
      {data && (
        <Card
          className="border-slate-200/90 shadow-sm rounded-2xl"
          title={
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1">
              <div>
                <span className="font-bold text-base text-slate-800">
                  Bảng Dữ Liệu Vĩ Mô & Khám Phá Chi Tiết
                </span>
                <p className="text-xs font-normal text-slate-500 m-0">
                  Xem toàn bộ các cột thông số, tỷ lệ đỗ, làm việc, chỉ tiêu đơn
                  hàng và tiến độ thưởng
                </p>
              </div>

              {/* Ô tìm kiếm nhanh trên bảng */}
              <div className="w-full sm:w-64">
                <Input
                  prefix={<Search className="w-3.5 h-3.5 text-slate-400" />}
                  placeholder="Lọc nhanh tên/nhà máy..."
                  size="small"
                  allowClear
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="rounded-lg"
                />
              </div>
            </div>
          }
        >
          <Tabs
            defaultActiveKey="factories"
            items={[
              {
                key: "factories",
                label: (
                  <span className="flex items-center gap-1.5 font-medium">
                    <Building2 className="w-4 h-4 text-blue-600" />
                    Theo Nhà Máy PV ({data.recruitment.factories?.length || 0})
                  </span>
                ),
                children: renderTable(
                  data.recruitment.factories,
                  recruitColumns,
                ),
              },
              {
                key: "orders",
                label: (
                  <span className="flex items-center gap-1.5 font-medium">
                    <Target className="w-4 h-4 text-indigo-600" />
                    Theo Đơn Hàng & Chỉ Tiêu (
                    {data.recruitment.orders?.length || 0})
                  </span>
                ),
                children: renderTable(data.recruitment.orders, [
                  {
                    title: "Đơn hàng",
                    dataIndex: "name",
                    key: "name",
                    width: 180,
                    render: (t: string, r: any) => (
                      <div>
                        <strong className="text-slate-800 block">{t}</strong>
                        <span className="text-xs text-slate-500">
                          {r.factory || "—"}
                        </span>
                      </div>
                    ),
                  },
                  {
                    title: "Chỉ tiêu (Target)",
                    dataIndex: "target",
                    key: "target",
                    width: 130,
                    render: (t: number | null) => (
                      <span className="font-semibold text-slate-700">
                        {t != null
                          ? `${t.toLocaleString("vi-VN")} người`
                          : "Chưa đặt"}
                      </span>
                    ),
                  },
                  {
                    title: "Đỗ / Mục tiêu",
                    dataIndex: "targetPassRate",
                    key: "targetPassRate",
                    width: 140,
                    sorter: (a: any, b: any) =>
                      (a.targetPassRate || 0) - (b.targetPassRate || 0),
                    render: (rate: number | null) =>
                      rate != null ? (
                        <div className="flex items-center gap-2">
                          <Progress
                            percent={rate}
                            size="small"
                            showInfo={false}
                            strokeColor={rate >= 100 ? "#16a34a" : "#2563eb"}
                            className="w-16"
                          />
                          <span className="text-xs font-semibold">{rate}%</span>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      ),
                  },
                  ...recruitColumns.slice(1),
                ]),
              },
              {
                key: "months",
                label: (
                  <span className="flex items-center gap-1.5 font-medium">
                    <Calendar className="w-4 h-4 text-emerald-600" />
                    Theo Tháng PV ({data.recruitment.months?.length || 0})
                  </span>
                ),
                children: renderTable(data.recruitment.months, recruitColumns),
              },
              {
                key: "statuses",
                label: (
                  <span className="flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="w-4 h-4 text-amber-600" />
                    Theo Tình Trạng ({data.recruitment.statuses?.length || 0})
                  </span>
                ),
                children: renderTable(
                  data.recruitment.statuses,
                  recruitColumns,
                ),
              },
              {
                key: "recruiters",
                label: (
                  <span className="flex items-center gap-1.5 font-medium">
                    <Users className="w-4 h-4 text-cyan-600" />
                    Theo Chuyên Viên Tuyển
                  </span>
                ),
                children: renderTable(
                  data.recruitment.recruiters,
                  recruitColumns,
                ),
              },
              {
                key: "teams",
                label: (
                  <span className="flex items-center gap-1.5 font-medium">
                    <Users className="w-4 h-4 text-purple-600" />
                    Theo Team Tuyển
                  </span>
                ),
                children: renderTable(data.recruitment.teams, recruitColumns),
              },
              {
                key: "bonusSummary",
                label: (
                  <span className="flex items-center gap-1.5 font-medium">
                    <Coins className="w-4 h-4 text-amber-600" />
                    Tiến Độ Thưởng (DS_THUONG)
                  </span>
                ),
                children: (
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-amber-50/70 p-3 rounded-xl border border-amber-200">
                      <div className="text-xs text-amber-900 flex items-center gap-1.5 font-medium">
                        <Coins className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>
                          Dữ liệu chi thưởng các lần 1 → 7 tổng hợp từ bảng tính <strong>DS_THUONG</strong>.
                        </span>
                      </div>
                      <Link
                        href="/bonuses"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs transition shrink-0"
                      >
                        <Coins className="w-3.5 h-3.5" />
                        <span>Vào trang Quản Lý Thưởng Chi Tiết</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                    <Tabs
                      type="card"
                    items={[
                      {
                        key: "bCompanies",
                        label: `Theo Công Ty / Nhà Máy (${(data.rewards.companies || sourcePaid?.companies)?.length || 0})`,
                        children: renderTable(
                          data.rewards.companies &&
                            data.rewards.companies.length > 0
                            ? data.rewards.companies
                            : (sourcePaid?.companies || []).map((c: any) => ({
                                name: c.name,
                                applications: c.rows,
                                eligible: c.rows,
                                achieved: c.rows,
                                achieveRate: 100,
                                earned: c.paid,
                                paid: c.paid,
                                outstanding: 0,
                              })),
                          rewardColumns,
                        ),
                      },
                      {
                        key: "bMonths",
                        label: "Theo Tháng Thưởng",
                        children: renderTable(
                          data.rewards.months,
                          rewardColumns,
                        ),
                      },
                      {
                        key: "bPolicies",
                        label: "Theo Chính Sách Thưởng",
                        children: renderTable(
                          data.rewards.policies,
                          rewardColumns,
                        ),
                      },
                      {
                        key: "bMilestones",
                        label: "Theo Mốc Công Đạt",
                        children: renderTable(
                          data.rewards.milestones,
                          rewardColumns,
                        ),
                      },
                    ]}
                  />
                  </div>
                ),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
