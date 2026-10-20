"use client";
import { useEffect, useState } from "react";
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  message,
  Space,
  Tag,
  Tabs,
  Alert,
} from "antd";
const kinds = [
  ["FACTORY", "Nhà máy"],
  ["TEAM", "Team"],
  ["RECRUITER", "Chuyên viên"],
  ["STATUS", "Trạng thái"],
  ["IMPORT", "Ánh xạ import / Sheets"],
];
export default function CatalogsPage() {
  const canWrite = true;
  const [kind, setKind] = useState("FACTORY"),
    [rows, setRows] = useState<any[]>([]),
    [teams, setTeams] = useState<any[]>([]),
    [edit, setEdit] = useState<any>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  async function load() {
    const j = await (await fetch(`/api/catalogs?kind=${kind}`)).json();
    if (j.success) setRows(j.data);
    else message.error(j.message);
  }
  useEffect(() => {
    load().catch(() => message.error("Không tải được danh mục"));
    fetch("/api/catalogs?kind=TEAM")
      .then((r) => r.json())
      .then((j) => setTeams(j.data || []));
  }, [kind]);
  function show(row: any) {
    setEdit(row);
    form.resetFields();
    form.setFieldsValue(
      row
        ? { ...row, mappingText: row.mappingJson }
        : {
            isActive: true,
            category: "NEW",
            warnsDuplicate: false,
            endsAssignment: false,
            sheetName: "DS_TONG",
            syncDirection: "IMPORT_ONLY",
            mappingText: JSON.stringify(
              {
                fullName: "Họ và tên",
                idCard: "số CCCD",
                interviewDate: "Ngày PV",
                interviewFactory: "Nhà máy PV",
              },
              null,
              2,
            ),
          },
    );
    setOpen(true);
  }
  async function save(values: any) {
    setBusy(true);
    try {
      let mapping;
      if (kind === "IMPORT") mapping = JSON.parse(values.mappingText);
      const j = await (
        await fetch("/api/catalogs", {
          method: edit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...values,
            mapping,
            id: edit?.id,
            updatedAt: edit?.updatedAt,
            kind,
          }),
        })
      ).json();
      if (j.success) {
        setOpen(false);
        load();
      } else message.error(j.message);
    } catch {
      message.error("Dữ liệu JSON hoặc kết nối không hợp lệ");
    } finally {
      setBusy(false);
    }
  }
  async function archive(row: any) {
    if (!window.confirm("Ngừng dùng mục này và giữ nguyên lịch sử?")) return;
    const j = await (
      await fetch("/api/catalogs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: row.id, updatedAt: row.updatedAt }),
      })
    ).json();
    if (j.success) load();
    else message.error(j.message);
  }
  return (
    <Card title="Danh mục và cấu hình">
      <Tabs
        activeKey={kind}
        onChange={setKind}
        items={kinds.map(([key, label]) => ({ key, label }))}
      />
      {kind === "IMPORT" && (
        <Alert
          className="mb-4"
          type="info"
          message="Ánh xạ và thiết kế đồng bộ"
          description="Thiết lập tên tab/cột và chiều đồng bộ. Chỉ đọc/ghi nguồn khi kết nối Google được cấp quyền, đã xem trước và duyệt thay đổi. Chưa bật đồng bộ tự động."
        />
      )}
      <Button type="primary" disabled={!canWrite} onClick={() => show(null)}>
        Thêm danh mục
      </Button>
      <Table<any>
        className="mt-4"
        rowKey="id"
        dataSource={rows}
        columns={[
          { title: "Mã", dataIndex: "code" },
          { title: "Tên", dataIndex: "name" },
          {
            title: "Nhóm / Team / Tab",
            render: (_, r) => r.category || r.team?.name || r.sheetName || "—",
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
                  Sửa / khôi phục
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
      />
      <Modal
        title="Danh mục"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={save}>
          {["FACTORY", "TEAM", "RECRUITER"].includes(kind) && (
            <Form.Item name="code" label="Mã" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          )}
          <Form.Item name="name" label="Tên" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="isActive"
            label="Đang sử dụng"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          {kind === "RECRUITER" && (
            <Form.Item name="teamId" label="Team">
              <Select
                allowClear
                options={teams
                  .filter((t) => t.isActive)
                  .map((t) => ({ value: t.id, label: t.name }))}
              />
            </Form.Item>
          )}
          {kind === "STATUS" && (
            <>
              <Form.Item name="category" label="Nhóm">
                <Select
                  options={[
                    { value: "TRAINING", label: "Đào tạo / đang làm" },
                    { value: "NEW", label: "Chưa đào tạo / chờ xử lý" },
                    { value: "STOP", label: "Dừng / kết thúc" },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="warnsDuplicate"
                label="Cảnh báo trùng CCCD/SĐT khi đang ở trạng thái này"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                name="endsAssignment"
                label="Kết thúc đợt làm việc"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </>
          )}
          {kind === "IMPORT" && (
            <>
              <Form.Item name="sheetName" label="Tên tab">
                <Input />
              </Form.Item>
              <Form.Item
                name="mappingText"
                label="Ánh xạ JSON: trường hệ thống → tên cột nguồn"
              >
                <Input.TextArea rows={8} />
              </Form.Item>
              <Form.Item name="sourceUrl" label="URL file Google Sheets">
                <Input />
              </Form.Item>
              <Form.Item name="syncDirection" label="Chiều đồng bộ">
                <Select
                  options={[
                    { value: "IMPORT_ONLY", label: "Nguồn → hệ thống" },
                    {
                      value: "TWO_WAY",
                      label: "Hai chiều (cần duyệt trước khi bật)",
                    },
                  ]}
                />
              </Form.Item>
            </>
          )}
          <Button htmlType="submit" type="primary" loading={busy}>
            Lưu
          </Button>
        </Form>
      </Modal>
    </Card>
  );
}
