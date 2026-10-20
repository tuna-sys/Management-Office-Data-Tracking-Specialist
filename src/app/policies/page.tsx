"use client";
import { useEffect, useState } from "react";
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  Space,
  Tag,
  message,
} from "antd";
import DateField from "@/components/DateField";
import { formatDate } from "@/lib/date-format";
export default function PoliciesPage() {
  const     canWrite = true;
  const [rows, setRows] = useState<any[]>([]),
    [orders, setOrders] = useState<any[]>([]),
    [edit, setEdit] = useState<any>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [form] = Form.useForm();
  async function load() {
    const j = await (await fetch("/api/policies")).json();
    if (j.success) setRows(j.data);
    else message.error(j.message);
  }
  useEffect(() => {
    load().catch(() => message.error("Không tải được chính sách"));
    fetch("/api/orders")
      .then((r) => r.json())
      .then((j) => setOrders(j.data || []));
  }, []);
  function show(row: any) {
    setEdit(row);
    form.resetFields();
    let rules = [];
    try {
      rules = JSON.parse(row?.rulesJson || "[]");
    } catch {}
    form.setFieldsValue({
      ...row,
      isActive: row?.isActive ?? true,
      rules: rules.length
        ? rules
        : [{ milestone: "", thresholdDays: null, amount: 0 }],
    });
    setOpen(true);
  }
  async function save(values: any) {
    if (
      !window.confirm("Lưu chính sách? Các đợt đã áp dụng vẫn giữ snapshot cũ.")
    )
      return;
    setBusy(true);
    try {
      const j = await (
        await fetch("/api/policies", {
          method: edit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...values,
            id: edit?.id,
            updatedAt: edit?.updatedAt,
            rules: values.rules.map((r: any, i: number) => ({
              ...r,
              step: i + 1,
            })),
          }),
        })
      ).json();
      if (j.success) {
        setOpen(false);
        await load();
      } else message.error(j.message);
    } catch {
      message.error("Không lưu được");
    } finally {
      setBusy(false);
    }
  }
  async function archive(row: any) {
    if (
      !window.confirm("Ngừng dùng chính sách và giữ lịch sử thưởng đã áp dụng?")
    )
      return;
    const j = await (
      await fetch("/api/policies", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, updatedAt: row.updatedAt }),
      })
    ).json();
    if (j.success) load();
    else message.error(j.message);
  }
  return (
    <Card title="Chính sách thưởng theo nhà máy / đơn hàng">
      <p className="mb-4 text-slate-500">
        Mỗi công ty có từ 1 đến 7 mốc riêng, thời hạn áp dụng theo ngày PV. Số
        công và điều kiện đạt được xác nhận thủ công; không lấy số ngày lịch làm
        ngày công.
      </p>
      <Button type="primary" disabled={!canWrite} onClick={() => show(null)}>
        Thêm chính sách
      </Button>
      <Table<any>
        className="mt-4"
        rowKey="id"
        dataSource={rows}
        columns={[
          { title: "Tên", dataIndex: "name" },
          { title: "Nhà máy", dataIndex: "factory" },
          {
            title: "Đơn hàng",
            render: (_, r) => r.order?.name || "Toàn nhà máy",
          },
          {
            title: "Hiệu lực",
            render: (_, r) =>
              `${r.effectiveFrom ? formatDate(r.effectiveFrom) : "Chưa đặt"} → ${r.effectiveTo ? formatDate(r.effectiveTo) : "Chưa đặt"}`,
          },
          {
            title: "Trạng thái",
            render: (_, r) => (
              <Tag color={r.isActive ? "green" : "default"}>
                {r.isActive ? "Đang dùng" : "Ngừng dùng"}
              </Tag>
            ),
          },
          {
            title: "Thao tác",
            render: (_, r) => (
              <Space>
                <Button disabled={!canWrite} onClick={() => show(r)}>
                  Sửa
                </Button>
                <Button
                  disabled={!canWrite || !r.isActive}
                  danger
                  onClick={() => archive(r)}
                >
                  Ngừng dùng
                </Button>
              </Space>
            ),
          },
        ]}
        expandable={{
          expandedRowRender: (r) => {
            let rules = [];
            try {
              rules = JSON.parse(r.rulesJson);
            } catch {}
            return (
              <Table<any>
                size="small"
                pagination={false}
                rowKey="step"
                dataSource={rules}
                columns={[
                  { title: "Mốc", dataIndex: "step" },
                  { title: "Nội dung thưởng", dataIndex: "milestone" },
                  { title: "Số công", dataIndex: "thresholdDays" },
                  {
                    title: "Số tiền",
                    dataIndex: "amount",
                    render: (v) => v.toLocaleString("vi-VN"),
                  },
                ]}
              />
            );
          },
        }}
      />
      <Modal
        title={edit ? "Sửa chính sách" : "Thêm chính sách"}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={760}
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item
              name="name"
              label="Tên chính sách"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="factory"
              label="Nhà máy/Công ty"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="orderId" label="Giới hạn theo đơn hàng">
              <Select
                allowClear
                options={orders
                  .filter((o) => o.isActive)
                  .map((o) => ({
                    value: o.id,
                    label: `${o.factory} · ${o.name}`,
                  }))}
                onChange={(id) => {
                  const o = orders.find((o) => o.id === id);
                  if (o) form.setFieldValue("factory", o.factory);
                }}
              />
            </Form.Item>
            <Form.Item
              name="isActive"
              label="Đang dùng"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="effectiveFrom"
              label="Ngày PV từ"
              rules={[{ required: true }]}
            >
              <DateField />
            </Form.Item>
            <Form.Item
              name="effectiveTo"
              label="Ngày PV đến"
              rules={[{ required: true }]}
            >
              <DateField />
            </Form.Item>
          </div>
          <Form.Item name="description" label="Ghi chú">
            <Input.TextArea />
          </Form.Item>
          <Form.List name="rules">
            {(fields, { add, remove }) => (
              <div>
                {fields.map((field, i) => (
                  <div key={field.key} className="grid grid-cols-4 gap-3">
                    <Form.Item
                      name={[field.name, "milestone"]}
                      label={`Mốc ${i + 1}: Nội dung`}
                      rules={[{ required: true }]}
                    >
                      <Input placeholder="Thưởng nóng / tiền xe / đủ công" />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "thresholdDays"]}
                      label="Điều kiện công"
                    >
                      <InputNumber min={0} step={0.5} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "amount"]}
                      label="Số tiền"
                      rules={[{ required: true }]}
                    >
                      <InputNumber min={0} precision={0} />
                    </Form.Item>
                    <Button
                      className="mt-7"
                      disabled={fields.length === 1}
                      onClick={() => remove(field.name)}
                    >
                      Bỏ mốc
                    </Button>
                  </div>
                ))}
                <Button
                  disabled={fields.length >= 7}
                  onClick={() =>
                    add({ milestone: "", thresholdDays: null, amount: 0 })
                  }
                >
                  Thêm mốc (tối đa 7)
                </Button>
              </div>
            )}
          </Form.List>
          <Button
            className="mt-4"
            type="primary"
            htmlType="submit"
            loading={busy}
          >
            Lưu chính sách
          </Button>
        </Form>
      </Modal>
    </Card>
  );
}
