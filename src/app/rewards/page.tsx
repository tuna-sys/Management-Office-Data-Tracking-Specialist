"use client";
import { useEffect, useState, useMemo } from "react";

import {
  Card,
  Table,
  Button,
  Form,
  Select,
  Modal,
  Input,
  InputNumber,
  Checkbox,
  message,
  Alert,
  Space,
  Tag,
  Tooltip,
} from "antd";
import { useIdentity } from "@/components/AuthGate";
import DateField from "@/components/DateField";
import { formatDate } from "@/lib/date-format";
import Link from "next/link";
import {
  LayoutDashboard,
  Coins,
  ArrowLeft,
  Search,
  Fingerprint,
  RotateCcw,
  Award,
  PlusCircle,
  Clock,
  CheckCircle2,
} from "lucide-react";

const MONTHS = [
  "T01.2026",
  "T02.2026",
  "T03.2026",
  "T04.2026",
  "T05.2026",
  "T06.2026",
  "T07.2026",
  "T08.2026",
  "T09.2026",
  "T10.2026",
  "T11.2026",
  "T12.2026",
];

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

const money = (n: number) => (n || 0).toLocaleString("vi-VN") + " đ";

export default function RewardsPage() {
  const user = useIdentity(),
    canWrite = user?.permissions.includes("bonus:write"),
    canPay = user?.permissions.includes("bonus:approve");
  const [rows, setRows] = useState<any[]>([]),
    [workers, setWorkers] = useState<any[]>([]),
    [policies, setPolicies] = useState<any[]>([]),
    [open, setOpen] = useState(false),
    [stage, setStage] = useState<any>(null),
    [payment, setPayment] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [selectedMonth, setSelectedMonth] = useState(""),
    [selectedFactory, setSelectedFactory] = useState(""),
    [idCardFilter, setIdCardFilter] = useState(""),
    [workerCodeFilter, setWorkerCodeFilter] = useState(""),
    [search, setSearch] = useState(""),
    [currentPage, setCurrentPage] = useState(1),
    [pageSize, setPageSize] = useState(10),
    [form] = Form.useForm(),
    [stageForm] = Form.useForm(),
    [payForm] = Form.useForm();
  const [assignmentId, setAssignmentId] = useState("");

  useEffect(() => {
    setAssignmentId(
      new URLSearchParams(window.location.search).get("assignmentId") || "",
    );
  }, []);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (assignmentId) params.append("assignmentId", assignmentId);
      if (selectedMonth) params.append("month", selectedMonth);
      if (selectedFactory) params.append("factory", selectedFactory);
      if (idCardFilter.trim()) params.append("idCard", idCardFilter.trim());
      if (workerCodeFilter.trim()) params.append("workerCode", workerCodeFilter.trim());
      if (search.trim()) params.append("search", search.trim());
      const res = await fetch("/api/enrollments?" + params.toString());
      const j = await res.json();
      if (j.success) setRows(j.data);
      else message.error(j.message);
    } catch {
      message.error("Không tải được thưởng");
    } finally {
      setLoading(false);
    }
  }

  const hasActiveFilters = Boolean(
    selectedMonth || selectedFactory || idCardFilter || workerCodeFilter || search,
  );

  const handleResetFilters = () => {
    setSelectedMonth("");
    setSelectedFactory("");
    setIdCardFilter("");
    setWorkerCodeFilter("");
    setSearch("");
    setCurrentPage(1);
  };

  useEffect(() => {
    Promise.all([
      fetch("/api/workers").then((r) => r.json()),
      fetch("/api/policies").then((r) => r.json()),
    ]).then(([w, p]) => {
      setWorkers(w.data || []);
      setPolicies(p.data || []);
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      load();
    }, 300);
    return () => clearTimeout(timer);
  }, [assignmentId, selectedMonth, selectedFactory, idCardFilter, workerCodeFilter, search]);

  async function apply(values: any) {
    setBusy(true);
    try {
      const j = await (
        await fetch("/api/enrollments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        })
      ).json();
      if (j.success) {
        setOpen(false);
        await load();
      } else message.error(j.message);
    } catch {
      message.error("Không áp dụng được chính sách");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(values: any) {
    setBusy(true);
    try {
      const j = await (
        await fetch("/api/enrollments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...values,
            id: stage.id,
            updatedAt: stage.updatedAt,
          }),
        })
      ).json();
      if (j.success) {
        setStage(null);
        await load();
      } else message.error(j.message);
    } catch {
      message.error("Không xác nhận được mốc");
    } finally {
      setBusy(false);
    }
  }

  async function pay(values: any) {
    if (
      !window.confirm(
        "Ghi nhận khoản tiền đã thực tế trả theo chứng từ này? Hệ thống không chuyển tiền.",
      )
    )
      return;
    setBusy(true);
    try {
      const j = await (
        await fetch("/api/reward-payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...values, stageId: payment.id }),
        })
      ).json();
      if (j.success) {
        setPayment(null);
        await load();
      } else message.error(j.message);
    } catch {
      message.error("Không lưu được khoản đã trả");
    } finally {
      setBusy(false);
    }
  }

  // Thống kê tài chính mốc thưởng
  const totalMilestoneMoney = rows.reduce(
    (sum, e) =>
      sum + (e.stages || []).reduce((sSum: number, s: any) => sSum + (s.amount || 0), 0),
    0,
  );
  const totalPaidMoney = rows.reduce(
    (sum, e) =>
      sum +
      (e.stages || []).reduce(
        (sSum: number, s: any) =>
          sSum + (s.payments || []).reduce((pSum: number, p: any) => pSum + (p.amount || 0), 0),
        0,
      ),
    0,
  );
  const totalRemainingMoney = rows.reduce(
    (sum, e) =>
      sum +
      (e.stages || []).reduce((sSum: number, s: any) => {
        if (!s.achieved) return sSum;
        const paid = (s.payments || []).reduce((pSum: number, p: any) => pSum + (p.amount || 0), 0);
        return sSum + Math.max(0, (s.amount || 0) - paid);
      }, 0),
    0,
  );

  const mainColumns = [
    {
      title: "STT",
      key: "stt",
      width: 65,
      align: "center" as const,
      render: (_: any, __: any, index: number) => (
        <span className="font-semibold text-slate-700">
          {(currentPage - 1) * pageSize + index + 1}
        </span>
      ),
    },
    {
      title: "Họ và tên",
      key: "name",
      width: 180,
      render: (_: any, e: any) => (
        <div>
          <a
            href={`/workers/${e.assignment.workerId}`}
            className="font-bold text-blue-600 hover:text-blue-800"
          >
            {e.assignment.worker.fullName}
          </a>
          <div className="text-[11px] text-slate-400">
            {e.assignment.worker.phone || "Chưa có SĐT"}
          </div>
        </div>
      ),
    },
    {
      title: "Số CCCD",
      key: "idCard",
      width: 140,
      render: (_: any, e: any) => (
        <span className="font-mono text-xs">{e.assignment.worker.idCard || "—"}</span>
      ),
    },
    {
      title: "Mã NV",
      key: "code",
      width: 120,
      render: (_: any, e: any) => (
        <Tag color="cyan">
          {e.assignment.employeeCode || e.assignment.worker.code || "Chưa cấp"}
        </Tag>
      ),
    },
    {
      title: "Công ty / Nhà máy",
      dataIndex: "factory",
      key: "factory",
      width: 150,
      render: (v: string) => <strong className="text-slate-800">{v}</strong>,
    },
    {
      title: "Ngày PV",
      key: "interviewDate",
      width: 110,
      render: (_: any, e: any) => formatDate(e.assignment.interviewDate),
    },
    {
      title: "Chính sách áp dụng",
      dataIndex: "policyName",
      key: "policyName",
      width: 220,
    },
    {
      title: "Tiến độ mốc",
      key: "progress",
      width: 130,
      render: (_: any, e: any) => {
        const achieved = (e.stages || []).filter((s: any) => s.achieved).length;
        const total = (e.stages || []).length;
        return (
          <Tag color={achieved === total && total > 0 ? "green" : achieved > 0 ? "blue" : "default"}>
            {achieved}/{total} mốc đạt
          </Tag>
        );
      },
    },
    {
      title: "Tổng mốc",
      key: "totalAmount",
      width: 130,
      align: "right" as const,
      render: (_: any, e: any) => {
        const sum = (e.stages || []).reduce((n: number, s: any) => n + (s.amount || 0), 0);
        return <span className="font-medium text-slate-700">{money(sum)}</span>;
      },
    },
    {
      title: "Đã chi trả",
      key: "paid",
      width: 130,
      align: "right" as const,
      render: (_: any, e: any) => {
        const paid = (e.stages || []).reduce(
          (n: number, s: any) =>
            n + (s.payments || []).reduce((pSum: number, p: any) => pSum + (p.amount || 0), 0),
          0,
        );
        return <strong className="text-emerald-700">{money(paid)}</strong>;
      },
    },
    {
      title: "Dư nợ còn lại",
      key: "remaining",
      width: 140,
      align: "right" as const,
      render: (_: any, e: any) => {
        const remaining = (e.stages || []).reduce((n: number, s: any) => {
          if (!s.achieved) return n;
          const paid = (s.payments || []).reduce((pSum: number, p: any) => pSum + (p.amount || 0), 0);
          return n + Math.max(0, (s.amount || 0) - paid);
        }, 0);
        return (
          <span className={remaining > 0 ? "font-bold text-amber-700" : "text-slate-400"}>
            {money(remaining)}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Quick links */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Link
            href="/"
            className="flex items-center gap-1 hover:text-blue-600 font-medium transition"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Tổng quan Dashboard</span>
          </Link>
          <span>/</span>
          <span className="font-semibold text-slate-800">Mốc thưởng & Đã trả</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-blue-600 bg-white hover:bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-xs transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Về Dashboard</span>
          </Link>
          <Link
            href="/bonuses"
            className="inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg border border-amber-200 shadow-xs transition font-medium"
          >
            <Coins className="w-3.5 h-3.5 text-amber-600" />
            <span>Quản lý Thưởng (DS_THUONG)</span>
          </Link>
        </div>
      </div>

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Theo Dõi Mốc Thưởng & Các Lần Chi Trả
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Quản lý điều kiện đạt mốc số ngày công, xét duyệt điều kiện thưởng và ghi nhận các lần chi tiền thực tế theo chứng từ.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="primary"
            disabled={!canWrite}
            icon={<PlusCircle className="w-4 h-4" />}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ assignmentId });
              setOpen(true);
            }}
          >
            Áp Dụng Chính Sách
          </Button>
        </div>
      </div>

      {/* Filter & Summary Bar */}
      <Card className="shadow-sm border-slate-200">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700 whitespace-nowrap">
                Kỳ Tháng:
              </span>
              <Select
                value={selectedMonth}
                onChange={(v) => {
                  setSelectedMonth(v);
                  setCurrentPage(1);
                }}
                className="w-36"
                options={[
                  { label: "Tất cả tháng", value: "" },
                  ...Array.from(
                    new Set([
                      ...MONTHS,
                      ...rows.map((r) => r.assignment?.onboardingMonth).filter(Boolean),
                    ]),
                  )
                    .sort()
                    .map((m) => ({ label: m, value: m })),
                ]}
              />
            </div>

            <Select
              placeholder="Tất cả Nhà máy"
              allowClear
              value={selectedFactory || undefined}
              onChange={(v) => {
                setSelectedFactory(v || "");
                setCurrentPage(1);
              }}
              className="w-48"
              options={[
                ...Array.from(
                  new Set([
                    ...FACTORIES,
                    ...rows.map((r) => r.factory).filter(Boolean),
                    ...rows.map((r) => r.assignment?.interviewFactory).filter(Boolean),
                  ]),
                )
                  .sort()
                  .map((f) => ({ label: f, value: f })),
              ]}
            />

            {/* Bộ lọc theo Căn cước (CCCD) */}
            <Input
              placeholder="Lọc theo số CCCD..."
              allowClear
              prefix={<Search className="w-3.5 h-3.5 text-slate-400" />}
              value={idCardFilter}
              onChange={(e) => {
                setIdCardFilter(e.target.value);
                setCurrentPage(1);
              }}
              onPressEnter={load}
              className="w-44 sm:w-48"
            />

            {/* Bộ lọc theo Mã nhân viên */}
            <Input
              placeholder="Lọc theo Mã NV..."
              allowClear
              prefix={<Fingerprint className="w-3.5 h-3.5 text-slate-400" />}
              value={workerCodeFilter}
              onChange={(e) => {
                setWorkerCodeFilter(e.target.value);
                setCurrentPage(1);
              }}
              onPressEnter={load}
              className="w-40 sm:w-44"
            />

            {hasActiveFilters && (
              <Button
                size="middle"
                onClick={handleResetFilters}
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                className="text-xs text-slate-500 hover:text-red-600 hover:border-red-300"
              >
                Đặt lại
              </Button>
            )}
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center gap-3 bg-purple-50 px-4 py-2.5 rounded-xl border border-purple-200 shrink-0">
            <Award className="w-5 h-5 text-purple-600" />
            <div>
              <div className="text-[11px] text-purple-700 font-semibold uppercase">
                {rows.length.toLocaleString("vi-VN")} hồ sơ · Đã trả / Còn lại
              </div>
              <div className="text-base font-black text-purple-900 flex items-center gap-1.5">
                <span className="text-emerald-700">{money(totalPaidMoney)}</span>
                <span className="text-slate-400 font-normal">/</span>
                <span className="text-amber-700">{money(totalRemainingMoney)}</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Main Table with STT and Pagination */}
      <Card className="shadow-sm border-slate-200 overflow-hidden">
        <Table<any>
          columns={mainColumns}
          dataSource={rows}
          rowKey="id"
          loading={loading}
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
              `${range[0]} - ${range[1]} / ${total} bản ghi`,
          }}
          bordered
          size="middle"
          scroll={{ x: 1400 }}
          expandable={{
            expandedRowRender: (e) => (
              <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600 pb-2 border-b border-slate-200">
                  <div>
                    <strong>Chi tiết tiến độ mốc thưởng:</strong> {e.assignment.worker.fullName} · {e.factory} · {e.policyName}
                  </div>
                  <div>
                    Đơn hàng: <strong>{e.assignment.order?.name || "Chưa gán"}</strong> · Đợt: <strong>{e.assignment.batch?.name || "Chưa gán"}</strong> · Hiệu lực: {formatDate(e.effectiveFrom)} → {formatDate(e.effectiveTo)}
                  </div>
                </div>

                <Table<any>
                  rowKey="id"
                  pagination={false}
                  size="small"
                  dataSource={e.stages}
                  columns={[
                    { title: "Mốc", dataIndex: "label", width: 120 },
                    { title: "Công yêu cầu", dataIndex: "thresholdDays", width: 110 },
                    {
                      title: "Tiền mốc",
                      dataIndex: "amount",
                      width: 120,
                      render: (v) => money(v),
                    },
                    {
                      title: "Điều kiện",
                      width: 140,
                      render: (_, s) => (
                        <Tag color={s.eligible ? "blue" : "default"}>
                          {s.eligible ? "Đủ điều kiện xét" : "Chưa xác nhận"}
                        </Tag>
                      ),
                    },
                    {
                      title: "Kết quả",
                      width: 120,
                      render: (_, s) => (
                        <Tag color={s.achieved ? "green" : "default"}>
                          {s.achieved ? "Đạt" : "Chưa đạt"}
                        </Tag>
                      ),
                    },
                    {
                      title: "Đã trả / còn lại",
                      width: 180,
                      render: (_, s) => {
                        const paid = (s.payments || []).reduce(
                          (n: number, p: any) => n + p.amount,
                          0,
                        );
                        return `${money(paid)} / ${money(s.achieved ? s.amount - paid : 0)}`;
                      },
                    },
                    {
                      title: "Thao tác",
                      width: 200,
                      render: (_, s) => (
                        <Space>
                          {e.isSourceExcel ? (
                            <Tag color={s.achieved ? "blue" : "default"}>
                              {s.achieved ? "Đã chi trả theo Excel" : "Không có thưởng"}
                            </Tag>
                          ) : (
                            <>
                              <Button
                                size="small"
                                disabled={!canWrite}
                                onClick={() => {
                                  setStage(s);
                                  stageForm.resetFields();
                                  stageForm.setFieldsValue({
                                    ...s,
                                    note: s.confirmationNote,
                                  });
                                }}
                              >
                                Xác nhận mốc
                              </Button>
                              <Button
                                size="small"
                                type="primary"
                                disabled={!canPay || !s.achieved}
                                onClick={() => {
                                  setPayment(s);
                                  payForm.resetFields();
                                }}
                              >
                                Ghi đã trả
                              </Button>
                            </>
                          )}
                        </Space>
                      ),
                    },
                  ]}
                  expandable={{
                    expandedRowRender: (s) => (
                      <div className="p-2 bg-white rounded border border-slate-200">
                        <div className="text-xs font-bold text-slate-700 mb-1.5">
                          Lịch sử chứng từ thanh toán đã ghi nhận:
                        </div>
                        <Table<any>
                          rowKey="id"
                          pagination={false}
                          size="small"
                          dataSource={s.payments}
                          columns={[
                            {
                              title: "Ngày trả",
                              dataIndex: "paidOn",
                              render: (value: string) => formatDate(value),
                            },
                            {
                              title: "Tiền thực trả",
                              dataIndex: "amount",
                              render: (v: number) => money(v),
                            },
                            { title: "Mã chứng từ", dataIndex: "reference" },
                            { title: "Người xác nhận", dataIndex: "confirmedBy" },
                            { title: "Ghi chú", dataIndex: "note" },
                          ]}
                          locale={{ emptyText: "Chưa có chứng từ chi trả nào cho mốc này" }}
                        />
                      </div>
                    ),
                  }}
                />
              </div>
            ),
          }}
        />
      </Card>
      <Modal
        title="Áp dụng chính sách riêng cho đợt lao động"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={apply}>
          <Form.Item
            name="assignmentId"
            label="Lao động / công ty / đợt tuyển"
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={workers.flatMap((w) =>
                w.assignments.map((a: any) => ({
                  value: a.id,
                  label: `${w.fullName} · ${a.interviewFactory} · PV ${formatDate(a.interviewDate)} · ${a.employeeCode || ""}`,
                })),
              )}
            />
          </Form.Item>
          <Form.Item
            name="policyId"
            label="Chính sách"
            rules={[{ required: true }]}
          >
            <Select
              options={policies
                .filter((p) => p.isActive)
                .map((p) => ({
                  value: p.id,
                  label: `${p.factory} · ${p.name} (${p.effectiveFrom ? formatDate(p.effectiveFrom) : "?"} → ${p.effectiveTo ? formatDate(p.effectiveTo) : "?"})`,
                }))}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            Áp dụng và lưu snapshot
          </Button>
        </Form>
      </Modal>
      <Modal
        title={stage?.label || "Xác nhận mốc"}
        open={!!stage}
        onCancel={() => setStage(null)}
        footer={null}
      >
        <Form form={stageForm} layout="vertical" onFinish={confirm}>
          <Form.Item name="eligible" valuePropName="checked">
            <Checkbox>Đã xác nhận đủ điều kiện xét mốc</Checkbox>
          </Form.Item>
          <Form.Item name="eligibleAsOf" label="Ngày xét điều kiện">
            <DateField />
          </Form.Item>
          <Form.Item name="achieved" valuePropName="checked">
            <Checkbox>Đạt mốc thưởng</Checkbox>
          </Form.Item>
          <Form.Item name="achievedOn" label="Ngày đạt mốc">
            <DateField />
          </Form.Item>
          <Form.Item name="note" label="Căn cứ / ghi chú">
            <Input.TextArea />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            Lưu xác nhận
          </Button>
        </Form>
      </Modal>
      <Modal
        title="Ghi nhận khoản đã trả thực tế"
        open={!!payment}
        onCancel={() => setPayment(null)}
        footer={null}
      >
        <Form form={payForm} layout="vertical" onFinish={pay}>
          <Form.Item name="amount" label="Số tiền" rules={[{ required: true }]}>
            <InputNumber min={1} precision={0} className="w-full" />
          </Form.Item>
          <Form.Item
            name="paidOn"
            label="Ngày trả"
            rules={[{ required: true }]}
          >
            <DateField />
          </Form.Item>
          <Form.Item
            name="reference"
            label="Mã chứng từ duy nhất"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea />
          </Form.Item>
          <Form.Item
            name="confirmActualPayment"
            valuePropName="checked"
            rules={[
              {
                validator: (_, v) =>
                  v
                    ? Promise.resolve()
                    : Promise.reject(new Error("Cần xác nhận đã trả thực tế")),
              },
            ]}
          >
            <Checkbox>
              Tôi đã đối chiếu chứng từ và xác nhận khoản này thực tế đã trả
            </Checkbox>
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            Ghi nhận
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
