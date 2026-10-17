"use client";
import { useEffect, useState } from "react";

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
} from "antd";
import { useIdentity } from "@/components/AuthGate";
import DateField from "@/components/DateField";
import { formatDate } from "@/lib/date-format";
import Link from "next/link";
import { LayoutDashboard, Coins, ArrowLeft } from "lucide-react";
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
    [search, setSearch] = useState(""),
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
    const j = await (
      await fetch(
        "/api/enrollments?" + new URLSearchParams({ assignmentId, search }),
      )
    ).json();
    if (j.success) setRows(j.data);
    else message.error(j.message);
  }
  useEffect(() => {
    load().catch(() => message.error("Không tải được thưởng"));
    Promise.all([
      fetch("/api/workers").then((r) => r.json()),
      fetch("/api/policies").then((r) => r.json()),
    ]).then(([w, p]) => {
      setWorkers(w.data || []);
      setPolicies(p.data || []);
    });
  }, [assignmentId]);
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
  return (
    <div className="space-y-4">
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

      <Card title="Theo dõi mốc thưởng và các lần chi trả">
        <Alert
          type="info"
          message="Theo từng công ty, chính sách và đợt làm việc"
          description="Điều kiện và số công được xác nhận thủ công. Đã trả chỉ tính các khoản có ngày trả, mã chứng từ và người xác nhận. Các bản ghi thưởng cũ không tự được coi là đã lĩnh."
        />
        <Space className="mt-4">
          <Input
            placeholder="Họ tên / CCCD / mã NV"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={load}
          />
          <Button onClick={load}>Tra cứu</Button>
          <Button
            type="primary"
            disabled={!canWrite}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ assignmentId });
              setOpen(true);
            }}
          >
            Áp dụng chính sách
          </Button>
        </Space>
      </Card>
      {rows.map((e) => (
        <Card
          key={e.id}
          title={`${e.assignment.worker.fullName} · ${e.factory} · ${e.policyName}`}
          extra={
            <a href={`/workers/${e.assignment.workerId}`}>Hồ sơ và lịch sử</a>
          }
        >
          <p className="mb-3 text-slate-500">
            Ngày PV {formatDate(e.assignment.interviewDate)} · Ngày đỗ{" "}
            {formatDate(e.assignment.passedDate)} ·{" "}
            {e.assignment.order?.name || "Chưa gán đơn hàng"} /{" "}
            {e.assignment.batch?.name || "Chưa gán đợt"} · hiệu lực{" "}
            {formatDate(e.effectiveFrom)} → {formatDate(e.effectiveTo)}
          </p>
          <Table<any>
            rowKey="id"
            pagination={false}
            size="small"
            dataSource={e.stages}
            columns={[
              { title: "Mốc", dataIndex: "label" },
              { title: "Công yêu cầu", dataIndex: "thresholdDays" },
              {
                title: "Tiền mốc",
                dataIndex: "amount",
                render: (v) => v.toLocaleString("vi-VN"),
              },
              {
                title: "Điều kiện",
                render: (_, s) => (
                  <Tag color={s.eligible ? "blue" : "default"}>
                    {s.eligible ? "Đủ điều kiện xét" : "Chưa xác nhận"}
                  </Tag>
                ),
              },
              {
                title: "Kết quả",
                render: (_, s) => (
                  <Tag color={s.achieved ? "green" : "default"}>
                    {s.achieved ? "Đạt" : "Chưa đạt"}
                  </Tag>
                ),
              },
              {
                title: "Đã trả / còn lại",
                render: (_, s) => {
                  const paid = s.payments.reduce(
                    (n: number, p: any) => n + p.amount,
                    0,
                  );
                  return `${paid.toLocaleString("vi-VN")} / ${(s.achieved ? s.amount - paid : 0).toLocaleString("vi-VN")}`;
                },
              },
              {
                title: "Thao tác",
                render: (_, s) => (
                  <Space>
                    <Button
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
                      disabled={!canPay || !s.achieved}
                      onClick={() => {
                        setPayment(s);
                        payForm.resetFields();
                      }}
                    >
                      Ghi đã trả
                    </Button>
                  </Space>
                ),
              },
            ]}
            expandable={{
              expandedRowRender: (s) => (
                <Table<any>
                  rowKey="id"
                  pagination={false}
                  dataSource={s.payments}
                  columns={[
                    {
                      title: "Ngày trả",
                      dataIndex: "paidOn",
                      render: (value: string) => formatDate(value),
                    },
                    { title: "Tiền", dataIndex: "amount" },
                    { title: "Chứng từ", dataIndex: "reference" },
                    { title: "Người xác nhận", dataIndex: "confirmedBy" },
                    { title: "Ghi chú", dataIndex: "note" },
                  ]}
                />
              ),
            }}
            scroll={{ x: 900 }}
          />
        </Card>
      ))}
      {!rows.length && (
        <Alert
          type="info"
          message="Chưa có chính sách được áp dụng trong bộ lọc"
        />
      )}
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
