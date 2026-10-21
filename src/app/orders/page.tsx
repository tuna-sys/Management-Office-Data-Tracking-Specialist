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
  Select,
  Switch,
  message,
  Tag,
  Space,
} from "antd";
import DateField from "@/components/DateField";
import { formatDate } from "@/lib/date-format";

export default function OrdersPage() {
  const canWrite = true;

  const [orders, setOrders] = useState<any[]>([]);
  const [factories, setFactories] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [kind, setKind] = useState("ORDER");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [form] = Form.useForm();

  async function load() {
    const [o, f] = await Promise.all([
      fetch("/api/orders").then((r) => r.json()),
      fetch("/api/catalogs?kind=FACTORY").then((r) => r.json()),
    ]);
    if (o.success) setOrders(o.data);
    else message.error(o.message);
    setFactories(f.data || []);
  }

  useEffect(() => {
    load().catch(() => message.error("Không tải được đơn hàng"));
  }, []);

  function show(k: string, row: any, orderId?: string) {
    setKind(k);
    setEdit(row);
    form.resetFields();
    form.setFieldsValue(row || { isActive: true, orderId });
    setOpen(true);
  }

  async function save(values: any) {
    setBusy(true);
    try {
      const f = factories.find((f) => f.id === values.factoryId);
      const r = await fetch("/api/orders", {
        method: edit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          factory: f?.name || values.factory,
          kind,
          id: edit?.id,
          updatedAt: edit?.updatedAt,
        }),
      });
      const j = await r.json();
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

  // Chức năng Ngừng tuyển đơn hàng (Soft delete)
  async function archive(row: any) {
    if (!window.confirm("Ngừng tuyển đơn hàng này? Lịch sử vẫn được giữ."))
      return;
    const r = await fetch("/api/orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, updatedAt: row.updatedAt }),
    });
    const j = await r.json();
    if (j.success) load();
    else message.error(j.message);
  }

  // Chức năng XÓA VĨNH VIỄN đơn hàng (Hard delete)
  async function removeOrder(row: any) {
    if (
      !window.confirm(
        `Xóa vĩnh viễn đơn hàng "${row.name}"? Thao tác này không thể hoàn tác.`,
      )
    )
      return;
    const r = await fetch("/api/orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: row.id,
        updatedAt: row.updatedAt,
        forceDelete: true,
      }),
    });
    const j = await r.json();
    if (j.success) {
      message.success("Đã xóa đơn hàng");
      load();
    } else {
      message.error(j.message);
    }
  }

  // Chức năng XÓA ĐỢT TUYỂN
  async function removeBatch(batch: any) {
    if (
      !window.confirm(
        `Xóa đợt tuyển "${batch.name}"? Thao tác này không thể hoàn tác.`,
      )
    )
      return;
    const r = await fetch("/api/orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "BATCH", id: batch.id }),
    });
    const j = await r.json();
    if (j.success) {
      message.success("Đã xóa đợt tuyển");
      load();
    } else {
      message.error(j.message);
    }
  }

  return (
    <Card title="Nhà máy → Đơn hàng → Đợt tuyển">
      <p className="mb-4 text-slate-500">
        Mỗi nhà máy có nhiều đơn hàng. Chỉ tiêu được nhập cho từng đợt; không tự
        chia chỉ tiêu giữa các tháng.
      </p>
      <Button
        disabled={!canWrite}
        type="primary"
        onClick={() => show("ORDER", null)}
      >
        Thêm đơn hàng
      </Button>

      <Table<any>
        className="mt-4"
        rowKey="id"
        dataSource={orders}
        columns={[
          { title: "Nhà máy", dataIndex: "factory" },
          { title: "Mã", dataIndex: "code" },
          { title: "Đơn hàng", dataIndex: "name" },
          {
            title: "Số hồ sơ",
            render: (_, r) => r._count?.assignments || 0,
          },
          {
            title: "Trạng thái",
            render: (_, r) => (
              <Tag color={r.isActive ? "green" : "default"}>
                {r.isActive ? "Đang tuyển" : "Ngừng tuyển"}
              </Tag>
            ),
          },
          {
            title: "Thao tác",
            render: (_, r) => (
              <Space>
                <Button disabled={!canWrite} onClick={() => show("ORDER", r)}>
                  Sửa
                </Button>
                <Button
                  disabled={!canWrite || !r.isActive}
                  onClick={() => show("BATCH", null, r.id)}
                >
                  Thêm đợt
                </Button>
                <Button
                  disabled={!canWrite || !r.isActive}
                  danger
                  onClick={() => archive(r)}
                >
                  Ngừng tuyển
                </Button>

                {/* --- NÚT XÓA ĐƠN HÀNG MỚI THÊM --- */}
                <Button
                  disabled={!canWrite}
                  danger
                  type="primary"
                  onClick={() => removeOrder(r)}
                >
                  Xóa
                </Button>
              </Space>
            ),
          },
        ]}
        expandable={{
          expandedRowRender: (r) => (
            <Table<any>
              rowKey="id"
              pagination={false}
              dataSource={r.batches}
              columns={[
                { title: "Mã đợt", dataIndex: "code" },
                { title: "Tên đợt", dataIndex: "name" },
                { title: "Kỳ tuyển", dataIndex: "periodMonth" },
                {
                  title: "Từ ngày",
                  dataIndex: "startDate",
                  render: (value: string) => formatDate(value),
                },
                {
                  title: "Đến ngày",
                  dataIndex: "endDate",
                  render: (value: string) => formatDate(value),
                },
                { title: "Chỉ tiêu", dataIndex: "target" },
                {
                  title: "Thao tác",
                  render: (_, b) => (
                    <Space>
                      <Button
                        disabled={!canWrite}
                        onClick={() => show("BATCH", b)}
                      >
                        Sửa
                      </Button>

                      {/* --- NÚT XÓA ĐỢT TUYỂN MỚI THÊM --- */}
                      <Button
                        disabled={!canWrite}
                        danger
                        onClick={() => removeBatch(b)}
                      >
                        Xóa
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          ),
        }}
        scroll={{ x: 900 }}
      />

      <Modal
        title={kind === "ORDER" ? "Đơn hàng tuyển dụng" : "Đợt tuyển dụng"}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item name="code" label="Mã" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="Tên" rules={[{ required: true }]}>
            <Input />
          </Form.Item>

          {kind === "ORDER" ? (
            <>
              <Form.Item name="factoryId" label="Nhà máy trong danh mục">
                <Select
                  allowClear
                  options={factories
                    .filter((f) => f.isActive)
                    .map((f) => ({ value: f.id, label: f.name }))}
                />
              </Form.Item>
              <Form.Item
                name="factory"
                label="Tên nhà máy (nếu chưa liên kết danh mục)"
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="isActive"
                label="Đang tuyển"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item
                name="orderId"
                label="Đơn hàng"
                rules={[{ required: true }]}
              >
                <Select
                  options={orders.map((o) => ({
                    value: o.id,
                    label: `${o.factory} · ${o.name}`,
                  }))}
                />
              </Form.Item>
              <Form.Item name="periodMonth" label="Kỳ chỉ tiêu tuyển">
                <Input type="month" />
              </Form.Item>
              <div className="grid grid-cols-2 gap-3">
                <Form.Item
                  name="startDate"
                  label="Bắt đầu"
                  rules={[{ required: true }]}
                >
                  <DateField />
                </Form.Item>
                <Form.Item
                  name="endDate"
                  label="Kết thúc"
                  rules={[{ required: true }]}
                >
                  <DateField />
                </Form.Item>
              </div>
              <Form.Item name="target" label="Chỉ tiêu số người">
                <InputNumber min={0} precision={0} />
              </Form.Item>
            </>
          )}

          <Button type="primary" htmlType="submit" loading={busy}>
            Lưu
          </Button>
        </Form>
      </Modal>
    </Card>
  );
}
