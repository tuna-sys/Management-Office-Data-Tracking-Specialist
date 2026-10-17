"use client";
import { useIdentity } from "@/components/AuthGate";
import { formatDate } from "@/lib/date-format";
import React, { useEffect, useState } from "react";
import {
  Table,
  Button,
  Select,
  Tag,
  Card,
  Modal,
  Form,
  InputNumber,
  Input,
  message,
  Popconfirm,
  Space,
} from "antd";
import Link from "next/link";
import {
  Coins,
  Download,
  CheckCircle,
  Lock,
  PlusCircle,
  FileCheck,
  Building,
  CreditCard,
  LayoutDashboard,
  ArrowLeft,
  Award,
  Search,
  Fingerprint,
  RotateCcw,
  User,
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
export default function BonusesPage() {
  const user = useIdentity();
  const canWrite = user?.permissions.includes("bonus:write");
  const canApprove = user?.permissions.includes("bonus:approve");
  const [editing, setEditing] = useState<any>(null);
  const [policies, setPolicies] = useState<any[]>([]);
  const [bonuses, setBonuses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [idCardFilter, setIdCardFilter] = useState("");
  const [workerCodeFilter, setWorkerCodeFilter] = useState("");
  // Modal thêm thưởng
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [workersList, setWorkersList] = useState<any[]>([]);
  const [addForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const hasActiveFilters = Boolean(
    selectedMonth || selectedCompany || idCardFilter || workerCodeFilter,
  );

  const handleResetFilters = () => {
    setSelectedMonth("");
    setSelectedCompany("");
    setIdCardFilter("");
    setWorkerCodeFilter("");
    setCurrentPage(1);
  };

  const fetchBonuses = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedMonth) params.append("month", selectedMonth);
      if (selectedCompany) params.append("company", selectedCompany);
      if (idCardFilter.trim()) params.append("idCard", idCardFilter.trim());
      if (workerCodeFilter.trim()) params.append("workerCode", workerCodeFilter.trim());
      const res = await fetch(`/api/bonuses?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setBonuses(json.data);
      }
    } catch (err) {
      message.error("Lỗi tải danh sách thưởng");
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkers = async () => {
    try {
      const res = await fetch("/api/workers");
      const json = await res.json();
      if (json.success) {
        setWorkersList(json.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchWorkers();
    fetch("/api/policies")
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setPolicies(j.data.filter((p: any) => p.isActive));
      })
      .catch(() => message.error("Không thể tải chính sách"));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchBonuses();
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedMonth, selectedCompany, idCardFilter, workerCodeFilter]);
  // Duyệt thưởng
  const handleApprove = async (id: string, newStatus: string) => {
    if (
      !window.confirm(
        newStatus === "LOCKED"
          ? "Khóa sổ bản ghi này? Sau khi khóa không thể chuyển trạng thái lại."
          : "Xác nhận duyệt số tiền thưởng của bản ghi này?",
      )
    )
      return;
    try {
      const res = await fetch("/api/bonuses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      const json = await res.json();
      if (json.success) {
        message.success(`Đã cập nhật trạng thái thưởng sang ${newStatus}`);
        fetchBonuses();
      } else {
        message.error(json.message || "Không thể cập nhật trạng thái");
      }
    } catch (err) {
      message.error("Lỗi phê duyệt");
    }
  };
  // Thêm thưởng mới
  const handleAddBonus = async (values: any) => {
    try {
      setSubmitting(true);
      const res = await fetch("/api/bonuses", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          id: editing?.id,
          updatedAt: editing?.updatedAt,
          assignmentId: workersList.find((w) => w.id === values.workerId)
            ?.assignments?.[0]?.id,
        }),
      });
      const json = await res.json();
      if (json.success) {
        message.success("Đã tạo bản ghi thưởng thành công");
        setIsAddModalOpen(false);
        addForm.resetFields();
        fetchBonuses();
      } else {
        message.error(json.message);
      }
    } catch (err) {
      message.error("Lỗi tạo thưởng");
    } finally {
      setSubmitting(false);
    }
  };
  const handleExport = async () => {
    try {
      const res = await fetch(
        `/api/excel-engine/export?type=PAYMENT_BATCH&month=${encodeURIComponent(selectedMonth)}`,
      );
      if (!res.ok) {
        const json = await res.json();
        message.error(json.message || "Không thể xuất lệnh chi");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `LenhChi_${selectedMonth}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      message.error("Lỗi xuất lệnh chi");
    }
  };
  const sourceInfo = (record: any) => {
    try {
      const n = JSON.parse(record.note || "{}");
      return n.source === "SOURCE_EXCEL_ACTUAL_PAID" ? n : null;
    } catch {
      return null;
    }
  };
  const columns = [
    {
      title: "STT",
      key: "stt",
      width: 70,
      align: "center" as const,
      render: (_: any, r: any, i: number) => {
        const sequentialIndex = (currentPage - 1) * pageSize + i + 1;
        const originalStt = sourceInfo(r)?.sourceValues?.STT;
        return (
          <span
            className="font-semibold text-slate-700"
            title={originalStt ? `STT file gốc: ${originalStt}` : undefined}
          >
            {sequentialIndex}
          </span>
        );
      },
    },
    { title: "Công ty", dataIndex: "company", width: 160 },
    {
      title: "Tháng",
      dataIndex: "month",
      width: 130,
      render: (v: string, r: any) => sourceInfo(r)?.monthOriginal || v,
    },
    {
      title: "Ngày PV",
      dataIndex: "interviewDate",
      width: 130,
      render: (value: string) => formatDate(value),
    },
    { title: "Chính sách", dataIndex: "policy", width: 280 },
    { title: "Mã nhân viên", dataIndex: "workerCode", width: 150 },
    {
      title: "Họ tên",
      key: "name",
      width: 190,
      render: (_: any, r: any) => r.worker?.fullName,
    },
    {
      title: "Số CCCD",
      key: "idCard",
      width: 160,
      render: (_: any, r: any) => r.worker?.idCard,
    },
    {
      title: "STK",
      key: "account",
      width: 180,
      render: (_: any, r: any) => {
        const n = sourceInfo(r);
        return (
          n?.sourceValues?.STK ??
          (r.worker?.bankAccounts?.length === 1
            ? r.worker.bankAccounts[0].accountNumber
            : "Chưa xác định")
        );
      },
    },
    {
      title: "Ngân hàng",
      key: "bank",
      width: 170,
      render: (_: any, r: any) => {
        const n = sourceInfo(r);
        return (
          n?.sourceValues?.["Ngân hàng"] ??
          (r.worker?.bankAccounts?.length === 1
            ? r.worker.bankAccounts[0].bankName
            : "Chưa xác định")
        );
      },
    },
    ...Array.from({ length: 7 }, (_, i) => ({
      title: `Thưởng lần ${i + 1}`,
      key: `bonus${i + 1}`,
      width: 230,
      render: (_: any, r: any) => {
        const n = sourceInfo(r);
        return n ? (
          <span className="whitespace-pre-wrap">{n.rewards?.[i] || "—"}</span>
        ) : (
          <span>
            {Number(r[`bonus${i + 1}`] || 0).toLocaleString("vi-VN")} đ
          </span>
        );
      },
    })),
    {
      title: "Tổng tiền (₫)",
      dataIndex: "totalBonus",
      width: 170,
      render: (v: number) => (
        <strong className="text-emerald-700">
          {Number(v || 0).toLocaleString("vi-VN")}
        </strong>
      ),
    },
    {
      title: "Nguồn / trạng thái",
      key: "status",
      width: 220,
      render: (_: any, r: any) =>
        sourceInfo(r) ? (
          <>
            <Tag color="blue">Đã trả theo Excel</Tag>
            <div className="text-xs text-slate-600">
              Chưa có ngày chi/chứng từ
            </div>
          </>
        ) : (
          <Tag>
            {r.status === "APPROVED"
              ? "Đã duyệt"
              : r.status === "LOCKED"
                ? "Đã khóa"
                : "Dự thảo nội bộ"}
          </Tag>
        ),
    },
    {
      title: "Thao tác",
      key: "actions",
      width: 220,
      render: (_: any, r: any) =>
        sourceInfo(r) ? (
          <span className="text-slate-600">Đối chiếu file gốc</span>
        ) : (
          <Space>
            {canWrite && r.status === "DRAFT" && (
              <Button
                size="small"
                onClick={() => {
                  setEditing(r);
                  addForm.resetFields();
                  addForm.setFieldsValue({ ...r });
                  setIsAddModalOpen(true);
                }}
              >
                Sửa dự thảo
              </Button>
            )}
            {canApprove && ["DRAFT", "REVIEWED"].includes(r.status) && (
              <Button
                size="small"
                onClick={() => handleApprove(r.id, "APPROVED")}
              >
                Duyệt
              </Button>
            )}
            {canApprove && r.status === "APPROVED" && (
              <Button
                size="small"
                onClick={() => handleApprove(r.id, "LOCKED")}
              >
                Khóa
              </Button>
            )}
          </Space>
        ),
    },
  ];
  const totalMonthAmount = bonuses.reduce(
    (sum, b) => sum + (b.totalBonus || 0),
    0,
  );
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
          <span className="font-semibold text-slate-800">Quản lý Thưởng (DS_THUONG)</span>
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
            href="/rewards"
            className="inline-flex items-center gap-1 text-xs text-purple-700 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-2.5 py-1.5 rounded-lg border border-purple-200 shadow-xs transition font-medium"
          >
            <Award className="w-3.5 h-3.5 text-purple-600" />
            <span>Mốc thưởng / Đã trả</span>
          </Link>
        </div>
      </div>

      {/* Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Quản Lý Tiền Thưởng & Định Mức Công (`DS_THUONG`)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Hiển thị các cột theo Thưởng.xlsx và nguyên nội dung Thưởng lần 1–7.
            Các khoản nguồn Excel là đã trả theo xác nhận của chủ dữ liệu; hiện
            vật không quy đổi ra tiền. Trạng thái duyệt nội bộ được tách riêng.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span>
            <Button
              type="primary"
              onClick={handleExport}
              disabled={!selectedMonth}
              className="bg-emerald-600 hover:bg-emerald-500"
              icon={<Download className="w-4 h-4" />}
            >
              Xuất File Chi Ngân Hàng ({selectedMonth})
            </Button>
          </span>
          <Button
            disabled={!canWrite}
            icon={<PlusCircle className="w-4 h-4" />}
            onClick={() => {
              setEditing(null);
              addForm.resetFields();
              setIsAddModalOpen(true);
            }}
          >
            Thêm Bản Ghi Thưởng
          </Button>
        </div>
      </div>

      {/* Filter & Summary Bar */}
      <Card className="shadow-sm border-slate-200">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700 whitespace-nowrap">
                Chọn Kỳ Tháng:
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
                  ...MONTHS.map((m) => ({ label: m, value: m })),
                ]}
              />
            </div>

            <Select
              placeholder="Tất cả Nhà máy"
              allowClear
              value={selectedCompany || undefined}
              onChange={(v) => {
                setSelectedCompany(v || "");
                setCurrentPage(1);
              }}
              className="w-44"
              options={FACTORIES.map((f) => ({ label: f, value: f }))}
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
              onPressEnter={fetchBonuses}
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
              onPressEnter={fetchBonuses}
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

          <div className="flex items-center gap-4 bg-amber-50 px-4 py-2.5 rounded-xl border border-amber-200 shrink-0">
            <Coins className="w-5 h-5 text-amber-600" />
            <div>
              <div className="text-[11px] text-amber-700 font-semibold uppercase">
                Tổng tiền ({bonuses.length.toLocaleString("vi-VN")} bản ghi)
              </div>
              <div className="text-lg font-black text-amber-800">
                {totalMonthAmount.toLocaleString("vi-VN")} VNĐ
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Bonus Table */}
      <Card className="shadow-sm border-slate-200 overflow-hidden">
        <Table
          columns={columns}
          dataSource={bonuses}
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
              `${range[0]} - ${range[1]} / ${total} bản ghi`,
          }}
          scroll={{ x: 4300 }}
          bordered
          size="middle"
        />
      </Card>

      {/* Modal Thêm Thưởng */}
      <Modal
        title={editing ? "Sửa dự thảo thưởng" : "Thêm Bản Ghi Thưởng Mới"}
        open={isAddModalOpen}
        onCancel={() => setIsAddModalOpen(false)}
        footer={null}
        width={650}
      >
        <Form
          form={addForm}
          layout="vertical"
          onFinish={handleAddBonus}
          initialValues={{
            month: selectedMonth,
            company: "Luxshare QC",
            bonus1: 0,
            bonus2: 0,
            bonus3: 0,
            bonus4: 0,
            bonus5: 0,
            bonus6: 0,
            bonus7: 0,
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
              placeholder="Tìm theo họ tên hoặc số CCCD"
              optionFilterProp="label"
              options={workersList.map((w) => ({
                label: `${w.fullName} - CCCD: ${w.idCard} (${w.assignments?.[0]?.interviewFactory || "N/A"})`,
                value: w.id,
              }))}
            />
          </Form.Item>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="month" label="Kỳ Tháng">
              <Select
                disabled={!!editing}
                options={[
                  { label: "Tất cả tháng", value: "" },
                  ...MONTHS.map((m) => ({ label: m, value: m })),
                ]}
              />
            </Form.Item>

            <Form.Item name="company" label="Nhà Máy / Công Ty">
              <Select
                disabled={!!editing}
                options={FACTORIES.map((f) => ({ label: f, value: f }))}
              />
            </Form.Item>

            <Form.Item name="bonus1" label="Thưởng Lần 1">
              <InputNumber
                className="w-full"
                min={0}
                precision={0}
                step={50000}
              />
            </Form.Item>

            <Form.Item name="bonus2" label="Thưởng Lần 2">
              <InputNumber
                className="w-full"
                min={0}
                precision={0}
                step={50000}
              />
            </Form.Item>

            <Form.Item name="bonus3" label="Thưởng Lần 3">
              <InputNumber
                className="w-full"
                min={0}
                precision={0}
                step={50000}
              />
            </Form.Item>

            <Form.Item name="bonus4" label="Thưởng Lần 4">
              <InputNumber
                className="w-full"
                min={0}
                precision={0}
                step={50000}
              />
            </Form.Item>
            {[5, 6, 7].map((n) => (
              <Form.Item key={n} name={`bonus${n}`} label={`Thưởng lần ${n}`}>
                <InputNumber
                  className="w-full"
                  min={0}
                  precision={0}
                  step={50000}
                />
              </Form.Item>
            ))}
            <Form.Item name="policyId" label="Chọn chính sách tham chiếu">
              <Select
                allowClear
                options={policies.map((p) => ({
                  value: p.id,
                  label: `${p.name} (${p.factory})`,
                }))}
                onChange={(id) => {
                  const p = policies.find((p) => p.id === id);
                  if (p) {
                    try {
                      const rules = JSON.parse(p.rulesJson);
                      addForm.setFieldsValue({
                        policy: p.name,
                        company: p.factory,
                      });
                      message.info(
                        "Đã chọn căn cứ. Chỉ nhập số tiền cho các mốc đã xác nhận đủ điều kiện.",
                      );
                    } catch {
                      message.error("Chính sách không hợp lệ");
                    }
                  }
                }}
              />
            </Form.Item>
            <Form.Item name="policy" label="Căn cứ tính thưởng">
              <Input placeholder="Nhập chính sách đã xác nhận" />
            </Form.Item>
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button onClick={() => setIsAddModalOpen(false)}>Hủy</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              Lưu Bản Ghi Thưởng
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
