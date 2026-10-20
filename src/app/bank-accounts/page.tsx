"use client";
import React, { useEffect, useState } from "react";
import {
  Table,
  Button,
  Tag,
  Card,
  Input,
  Select,
  Modal,
  Form,
  Checkbox,
  message,
  Space,
  Badge,
  Tooltip,
} from "antd";
import {
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  Search,
  PlusCircle,
  RefreshCw,
  Building2,
  Download,
} from "lucide-react";
const POPULAR_BANKS = [
  "Vietcombank",
  "Techcombank",
  "MB Bank",
  "BIDV",
  "VietinBank",
  "Agribank",
  "VPBank",
  "TPBank",
  "Sacombank",
];
export default function BankAccountsPage() {
  const canWrite = true;
  const [editing, setEditing] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // Modal thêm tài khoản
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [workersList, setWorkersList] = useState<any[]>([]);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (filter) params.append("filter", filter);
      const res = await fetch(`/api/bank-accounts?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setAccounts(json.data);
      }
    } catch (err) {
      message.error("Lỗi tải danh sách tài khoản");
    } finally {
      setLoading(false);
    }
  };
  const fetchWorkers = async () => {
    try {
      const res = await fetch("/api/workers");
      const json = await res.json();
      if (json.success) setWorkersList(json.data);
    } catch (err) {
      console.error(err);
    }
  };
  useEffect(() => {
    fetchAccounts();
    fetchWorkers();
  }, [filter]);
  // Dịch vụ chưa được kết nối
  const handleVerifyVietQR = async () => {
    const bankName = form.getFieldValue("bankName");
    const accountNumber = form.getFieldValue("accountNumber");
    if (!bankName || !accountNumber) {
      message.warning("Vui lòng nhập Ngân hàng và Số tài khoản trước");
      return;
    }
    try {
      setVerifying(true);
      const res = await fetch("/api/bank-accounts/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankName, accountNumber }),
      });
      const json = await res.json();
      if (json.success) {
        form.setFieldsValue({ accountHolderName: json.data.accountHolderName });
        message.success(
          `Đã tìm thấy chủ tài khoản: ${json.data.accountHolderName}`,
        );
      } else {
        message.warning(json.message || "Chưa thể xác minh tài khoản");
      }
    } catch (err) {
      message.error("Lỗi tra cứu VietQR");
    } finally {
      setVerifying(false);
    }
  };
  const handleAddAccount = async (values: any) => {
    try {
      setSubmitting(true);
      const res = await fetch("/api/bank-accounts", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          id: editing?.id,
          updatedAt: editing?.updatedAt,
        }),
      });
      const json = await res.json();
      if (json.success) {
        message.success("Đã lưu thông tin tài khoản; chưa xác minh ngân hàng");
        setIsModalOpen(false);
        form.resetFields();
        fetchAccounts();
      } else {
        message.error(json.message);
      }
    } catch (err) {
      message.error("Lỗi thêm tài khoản");
    } finally {
      setSubmitting(false);
    }
  };
  const columns = [
    {
      title: "Thao tác",
      key: "actions",
      render: (_: any, record: any) => (
        <Button
          disabled={!canWrite}
          onClick={() => {
            setEditing(record);
            form.resetFields();
            form.setFieldsValue(record);
            setIsModalOpen(true);
          }}
        >
          Sửa
        </Button>
      ),
    },
    {
      title: "STT",
      key: "stt",
      width: 50,
      align: "center" as const,
      render: (_: any, __: any, idx: number) => idx + 1,
    },
    {
      title: "Lao Động (CCCD)",
      key: "worker",
      render: (_: any, record: any) => (
        <div>
          <div className="font-bold text-slate-900">
            {record.worker?.fullName}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            CCCD: {record.worker?.idCard}
          </div>
          <div className="text-[11px] text-slate-400">
            Nhà máy:{" "}
            {record.worker?.assignments?.[0]?.interviewFactory || "N/A"}
          </div>
        </div>
      ),
    },
    {
      title: "Ngân Hàng",
      dataIndex: "bankName",
      key: "bankName",
      render: (text: string) => (
        <span className="font-semibold text-slate-700 flex items-center gap-1.5 text-xs">
          <Building2 className="w-3.5 h-3.5 text-slate-400" />
          {text}
        </span>
      ),
    },
    {
      title: "Số Tài Khoản (STK)",
      dataIndex: "accountNumber",
      key: "accountNumber",
      render: (text: string) => (
        <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
          {text}
        </span>
      ),
    },
    {
      title: "Tên Chủ Tài Khoản (Đã Nhập)",
      dataIndex: "accountHolderName",
      key: "accountHolderName",
      render: (text: string) => (
        <span className="font-bold uppercase text-slate-800">{text}</span>
      ),
    },
    {
      title: "Kết Quả Đối Soát Khớp Tên",
      key: "verificationStatus",
      render: (_: any, record: any) => {
        if (record.verificationStatus === "UNVERIFIED")
          return <Tag color="warning">Chưa xác minh ngân hàng</Tag>;
        if (record.verificationStatus === "VALID") {
          return (
            <Tag
              color="success"
              icon={<CheckCircle2 className="w-3 h-3 inline mr-1" />}
            >
              Khớp tên (chưa xác minh ngân hàng)
            </Tag>
          );
        }
        if (record.verificationStatus === "AUTHORIZED") {
          return (
            <Tooltip
              title={`Ủy quyền nhận thay (${record.authorizedRelation || "Mượn thẻ"})`}
            >
              <Tag
                color="purple"
                icon={<UserCheck className="w-3 h-3 inline mr-1" />}
              >
                Khai báo ủy quyền ({record.authorizedRelation || "Mượn thẻ"})
              </Tag>
            </Tooltip>
          );
        }
        return (
          <Tooltip
            title={record.warningMessage || "Tên trên thẻ khác tên CCCD"}
          >
            <Tag
              color="error"
              icon={<AlertTriangle className="w-3 h-3 inline mr-1" />}
            >
              LỆCH TÊN CCCD
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "Người Check & Ghi Chú",
      key: "checkInfo",
      render: (_: any, record: any) => (
        <div className="text-xs text-slate-600">
          <div>{record.checkedBy || "Hệ thống"}</div>
          <div className="text-[11px] text-slate-400">
            {record.checkResult || "-"}
          </div>
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Tài Chính & Xác Thực STK Ngân Hàng 2026
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Tên nhập thủ công chỉ dùng đối chiếu hồ sơ. Chưa kết nối xác minh
            ngân hàng; lệnh chi được chặn cho đến khi đủ bằng chứng.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="primary"
            disabled={!canWrite}
            icon={<PlusCircle className="w-4 h-4" />}
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setIsModalOpen(true);
            }}
          >
            Thêm Tài Khoản Mới
          </Button>
        </div>
      </div>

      {/* Filter Cards */}
      <Card className="shadow-sm border-slate-200">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            placeholder="Tìm theo STK, Tên chủ thẻ, CCCD..."
            prefix={<Search className="w-4 h-4 text-slate-400" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={fetchAccounts}
            allowClear
          />
          <Select
            value={filter}
            onChange={setFilter}
            options={[
              { label: "Tất cả tài khoản", value: "ALL" },
              { label: "Chưa xác minh ngân hàng", value: "UNVERIFIED" },
              {
                label: "Khớp tên trong dữ liệu cũ (chưa xác minh)",
                value: "VALID",
              },
              { label: "CẢNH BÁO: Lệch tên CCCD", value: "MISMATCH" },
              {
                label: "Khai báo ủy quyền trong dữ liệu cũ",
                value: "AUTHORIZED",
              },
            ]}
          />
          <Button
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={fetchAccounts}
          >
            Làm Mới Danh Sách
          </Button>
        </div>
      </Card>

      {/* Table */}
      <Card className="shadow-sm border-slate-200 overflow-hidden">
        <Table
          columns={columns}
          dataSource={accounts}
          rowKey="id"
          loading={loading}
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            showSizeChanger: true,
            pageSizeOptions: ["10", "20", "50", "100", "200"],
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size);
            },
            showTotal: (total, range) =>
              `${range[0]} - ${range[1]} / ${total} tài khoản`,
          }}
          bordered
          size="middle"
        />
      </Card>

      {/* Modal Thêm STK */}
      <Modal
        title="Thông tin tài khoản ngân hàng — chưa xác minh"
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAddAccount}
          initialValues={{
            bankName: "Vietcombank",
            isAuthorized: false,
          }}
          className="mt-4"
        >
          <Form.Item
            name="workerId"
            label="Chọn Lao Động"
            rules={[{ required: true, message: "Vui lòng chọn lao động" }]}
          >
            <Select
              disabled={!!editing}
              showSearch
              placeholder="Chọn người lao động để liên kết STK"
              optionFilterProp="label"
              options={workersList.map((w) => ({
                label: `${w.fullName} - CCCD: ${w.idCard}`,
                value: w.id,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="bankName"
            label="Ngân Hàng Thụ Hưởng"
            rules={[{ required: true, message: "Vui lòng chọn ngân hàng" }]}
          >
            <Select
              options={POPULAR_BANKS.map((b) => ({ label: b, value: b }))}
            />
          </Form.Item>

          <div className="flex gap-2 items-start">
            <Form.Item
              name="accountNumber"
              label="Số Tài Khoản (STK)"
              className="flex-1"
              rules={[{ required: true, message: "Vui lòng nhập STK" }]}
            >
              <Input placeholder="1023456789" />
            </Form.Item>
            <Button
              className="mt-7"
              onClick={handleVerifyVietQR}
              loading={verifying}
              icon={<Search className="w-3.5 h-3.5" />}
            >
              Kiểm tra kết nối
            </Button>
          </div>

          <Form.Item
            name="accountHolderName"
            label="Tên Chủ Tài Khoản"
            rules={[
              { required: true, message: "Vui lòng nhập tên chủ tài khoản" },
            ]}
            extra="Hệ thống sẽ tự động so khớp tên này với tên trên CCCD của người lao động"
          >
            <Input placeholder="NGUYEN VAN A" />
          </Form.Item>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-4">
            <Form.Item
              name="isAuthorized"
              valuePropName="checked"
              className="mb-2"
            >
              <Checkbox>
                Đây là tài khoản ủy quyền (Lao động mượn thẻ người thân)
              </Checkbox>
            </Form.Item>

            <Form.Item
              noStyle
              shouldUpdate={(prev, cur) =>
                prev.isAuthorized !== cur.isAuthorized
              }
            >
              {({ getFieldValue }) =>
                getFieldValue("isAuthorized") ? (
                  <Form.Item
                    name="authorizedRelation"
                    label="Mối Quan Hệ Ủy Quyền"
                    rules={[
                      { required: true, message: "Vui lòng ghi rõ quan hệ" },
                    ]}
                    className="mb-0"
                  >
                    <Select
                      options={[
                        { label: "Vợ / Chồng", value: "Vợ/Chồng" },
                        { label: "Bố / Mẹ", value: "Bố/Mẹ" },
                        { label: "Anh / Chị / Em ruột", value: "Anh/Chị/Em" },
                        { label: "Khác", value: "Khác" },
                      ]}
                    />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button onClick={() => setIsModalOpen(false)}>Hủy</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              Lưu thông tin chưa xác minh
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
