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
  PlusCircle,
  Trash2,
  LayoutDashboard,
  ArrowLeft,
  Award,
  Search,
  Fingerprint,
  RotateCcw,
} from "lucide-react";
const currentYear = new Date().getFullYear();
const MONTHS = Array.from({ length: 36 }, (_, index) => {
  const date = new Date(currentYear - 1, index, 1);
  return `T${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
});
const DEFAULT_MONTH = `T${String(new Date().getMonth() + 1).padStart(2, "0")}.${currentYear}`;
const ALL_FILTER = "__ALL_FILTER__";
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
  const [companyChoices, setCompanyChoices] = useState<string[]>(FACTORIES);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedCompany, setSelectedCompany] = useState<string[]>([]);
  const [idCardFilter, setIdCardFilter] = useState("");
  const [workerCodeFilter, setWorkerCodeFilter] = useState("");
  // Modal thêm thưởng
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [workersList, setWorkersList] = useState<any[]>([]);
  const [addForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const selectedAddWorkerId = Form.useWatch("workerId", addForm);
  const selectedAddWorker = workersList.find(
    (worker) => worker.id === selectedAddWorkerId,
  );
  const fetchBonuses = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      selectedMonth.forEach((month) => params.append("month", month));
      selectedCompany.forEach((company) => params.append("company", company));
      const res = await fetch(`/api/bonuses?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setBonuses(json.data);
        setCompanyChoices((current) =>
          Array.from(
            new Set([
              ...current,
              ...json.data
                .map((record: any) => record.company)
                .filter(
                  (company: unknown): company is string =>
                    typeof company === "string" && Boolean(company.trim()),
                ),
            ]),
          ),
        );
      }
      else message.error(json.message || "Lỗi tải danh sách thưởng");
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
    fetchBonuses();
    fetchWorkers();
    fetch("/api/policies")
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setPolicies(j.data.filter((p: any) => p.isActive));
      })
      .catch(() => message.error("Không thể tải chính sách"));
  }, [selectedMonth, selectedCompany]);
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
          assignmentId: values.assignmentId,
        }),
      });
      const json = await res.json();
      if (json.success) {
        message.success(
          editing
            ? "Đã cập nhật bản thưởng"
            : "Đã tạo bản ghi thưởng thành công",
        );
        setIsAddModalOpen(false);
        setEditing(null);
        addForm.resetFields();
        void fetchBonuses();
      } else {
        message.error(json.message);
      }
    } catch (err) {
      message.error("Lỗi tạo thưởng");
    } finally {
      setSubmitting(false);
    }
  };
  const handleDeleteBonus = async (id?: string) => {
    try {
      const res = await fetch("/api/bonuses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : { all: true, confirmAll: true }),
      });
      const json = await res.json();
      if (!json.success) {
        message.error(json.message || "Không thể xóa bản thưởng");
        return;
      }
      message.success(
        id ? "Đã xóa bản thưởng" : `Đã xóa ${json.deletedCount} bản thưởng`,
      );
      setCurrentPage(1);
      void fetchBonuses();
    } catch {
      message.error("Lỗi khi xóa bản thưởng");
    }
  };
  const handleExport = async () => {
    if (selectedMonth.length !== 1) {
      message.info("Chọn đúng một kỳ tháng để xuất lệnh chi");
      return;
    }
    const exportMonth = selectedMonth[0];
    try {
      const res = await fetch(
        `/api/excel-engine/export?type=PAYMENT_BATCH&month=${encodeURIComponent(exportMonth)}`,
      );
      if (!res.ok) {
        const json = await res.json();
        message.error(json.message || "Không thể xuất lệnh chi");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `LenhChi_${exportMonth}.xlsx`;
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
  const filteredBonuses = bonuses.filter((record) => {
    const sourceValues = sourceInfo(record)?.sourceValues || {};
    const idCard = String(
      record.worker?.idCard ??
        sourceValues["Số CCCD"] ??
        sourceValues.CCCD ??
        "",
    ).toLowerCase();
    const workerCode = String(
      record.workerCode ??
        record.worker?.code ??
        sourceValues["Mã nhân viên"] ??
        sourceValues.workerCode ??
        "",
    ).toLowerCase();
    return (
      idCard.includes(idCardFilter.trim().toLowerCase()) &&
      workerCode.includes(workerCodeFilter.trim().toLowerCase())
    );
  });
  const companyOptions = Array.from(
    new Set([
      ...companyChoices,
      ...selectedCompany,
    ]),
  );
  const hasActiveFilters = Boolean(
    selectedMonth.length > 0 ||
      selectedCompany.length > 0 ||
      idCardFilter ||
      workerCodeFilter,
  );
  const handleResetFilters = () => {
    setSelectedMonth([]);
    setSelectedCompany([]);
    setIdCardFilter("");
    setWorkerCodeFilter("");
    setCurrentPage(1);
  };
  const columns = [
    {
      title: "STT",
      key: "stt",
      width: 70,
      align: "center" as const,
      render: (_: any, r: any, i: number) => {
        const sequentialIndex = (currentPage - 1) * pageSize + i + 1;
        const originalStt =
          sourceInfo(r)?.sequence || sourceInfo(r)?.sourceValues?.STT;
        return (
          <span
            className="font-semibold text-slate-700"
            title={originalStt ? `STT file gốc: ${originalStt}` : undefined}
          >
            {originalStt || sequentialIndex}
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
      render: (_: any, r: any) =>
        sourceInfo(r)?.sourceValues?.["Họ tên"] ??
        sourceInfo(r)?.sourceValues?.["Họ và tên"] ??
        r.worker?.fullName ??
        "—",
    },
    {
      title: "Số CCCD",
      key: "idCard",
      width: 160,
      render: (_: any, r: any) =>
        sourceInfo(r)?.sourceValues?.["Số CCCD"] ??
        sourceInfo(r)?.sourceValues?.CCCD ??
        r.worker?.idCard ??
        "—",
    },
    {
      title: "STK",
      key: "account",
      width: 180,
      render: (_: any, r: any) => {
        const n = sourceInfo(r);
        return (
          r.accountNumber ||
          n?.sourceValues?.STK ||
          n?.sourceValues?.["Số tài khoản"] ||
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
          r.bankName ||
          n?.sourceValues?.["Ngân hàng"] ||
          n?.sourceValues?.["Tên ngân hàng"] ||
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
          <span className="whitespace-pre-wrap">{n.rewards?.[i] ?? "—"}</span>
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
      width: 290,
      render: (_: any, r: any) => (
        <Space wrap>
          {sourceInfo(r) && (
            <span className="text-slate-600">Đối chiếu file gốc</span>
          )}
          {canWrite && r.status === "DRAFT" && (
            <Button
              size="small"
              onClick={() => {
                setEditing(r);
                addForm.resetFields();
                addForm.setFieldsValue({
                  ...r,
                  fullName: r.worker?.fullName,
                  idCard: r.worker?.idCard,
                });
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
            <Button size="small" onClick={() => handleApprove(r.id, "LOCKED")}>
              Khóa
            </Button>
          )}
          {canWrite && (
            <Popconfirm
              title="Xóa bản thưởng này?"
              description="Thao tác này không thể hoàn tác."
              okText="Xóa"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDeleteBonus(r.id)}
            >
              <Button
                size="small"
                danger
                icon={<Trash2 className="w-3.5 h-3.5" />}
              >
                Xóa
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];
  const totalMonthAmount = filteredBonuses.reduce(
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
          <span className="font-semibold text-slate-800">
            Quản lý Thưởng (DS_THUONG)
          </span>
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
              disabled={selectedMonth.length !== 1}
              className="bg-emerald-600 hover:bg-emerald-500"
              icon={<Download className="w-4 h-4" />}
            >
              Xuất File Chi Ngân Hàng{" "}
              {selectedMonth.length === 1
                ? `(${selectedMonth[0]})`
                : "(chọn 1 tháng)"}
            </Button>
          </span>
          {canWrite && (
            <Popconfirm
              title="Xóa toàn bộ bản thưởng?"
              description={`Sẽ xóa tất cả bản ghi thưởng trong CSDL, kể cả các dòng đang bị bộ lọc ẩn. Hiện có ${bonuses.length} dòng đang tải. Thao tác này không thể hoàn tác.`}
              okText="Xóa toàn bộ"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDeleteBonus()}
            >
              <Button danger icon={<Trash2 className="w-4 h-4" />}>
                Xóa toàn bộ bản thưởng
              </Button>
            </Popconfirm>
          )}
          <Button
            disabled={!canWrite}
            icon={<PlusCircle className="w-4 h-4" />}
            onClick={() => {
              setEditing(null);
              addForm.resetFields();
              addForm.setFieldsValue({
                month:
                  selectedMonth.length === 1
                    ? selectedMonth[0]
                    : DEFAULT_MONTH,
                bonus1: 0,
                bonus2: 0,
                bonus3: 0,
                bonus4: 0,
                bonus5: 0,
                bonus6: 0,
                bonus7: 0,
              });
              setIsAddModalOpen(true);
            }}
          >
            Thêm Bản Ghi Thưởng
          </Button>
        </div>
      </div>

      {/* Filter & Summary Bar */}
      <Card className="shadow-sm border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-700">
              Chọn Kỳ Tháng:
            </span>
            <Select
              mode="multiple"
              allowClear
              value={selectedMonth}
              onChange={(values: string[]) => {
                setSelectedMonth(values.includes(ALL_FILTER) ? [] : values);
                setCurrentPage(1);
              }}
              placeholder="Tất cả tháng"
              className="w-48"
              options={[
                { label: "Tất cả tháng", value: ALL_FILTER },
                ...MONTHS.map((m) => ({ label: m, value: m })),
              ]}
            />
            <Select
              mode="multiple"
              allowClear
              value={selectedCompany}
              onChange={(values: string[]) => {
                setSelectedCompany(values.includes(ALL_FILTER) ? [] : values);
                setCurrentPage(1);
              }}
              placeholder="Tất cả công ty"
              className="w-56"
              options={[
                { label: "Tất cả công ty", value: ALL_FILTER },
                ...companyOptions.map((factory) => ({
                  label: factory,
                  value: factory,
                })),
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
                Tổng số tiền trong danh sách {selectedMonth.length
                  ? selectedMonth.join(", ")
                  : "tất cả tháng"}
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
          dataSource={filteredBonuses}
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
        onCancel={() => {
          setIsAddModalOpen(false);
          setEditing(null);
        }}
        footer={null}
        width={850}
      >
        <Form
          form={addForm}
          layout="vertical"
          onFinish={handleAddBonus}
          initialValues={{
            month:
              selectedMonth.length === 1
                ? selectedMonth[0]
                : DEFAULT_MONTH,
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
              onChange={(workerId) => {
                const worker = workersList.find((w) => w.id === workerId);
                const assignment = worker?.assignments?.[0];
                const bank = worker?.bankAccounts?.[0];
                addForm.setFieldsValue({
                  fullName: worker?.fullName || "",
                  idCard: worker?.idCard || "",
                  assignmentId: assignment?.id,
                  company:
                    assignment?.workingFactory ||
                    assignment?.interviewFactory ||
                    "",
                  interviewDate: assignment?.interviewDate || "",
                  workerCode: assignment?.employeeCode || worker?.code || "",
                  accountNumber: bank?.accountNumber || "",
                  bankName: bank?.bankName || "",
                });
              }}
            />
          </Form.Item>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="fullName" label="Họ tên">
              <Input disabled />
            </Form.Item>
            <Form.Item name="idCard" label="Số CCCD">
              <Input disabled />
            </Form.Item>
            <Form.Item
              name="assignmentId"
              label="Đợt tuyển dụng"
            >
              <Select
                disabled={!!editing}
                allowClear
                placeholder="Chọn đợt tuyển dụng"
                options={(selectedAddWorker?.assignments || []).map(
                  (a: any) => ({
                    value: a.id,
                    label: `${a.workingFactory || a.interviewFactory || "Chưa có công ty"} · PV ${a.interviewDate || "chưa có ngày"} · ${a.employeeCode || "chưa có mã NV"}`,
                  }),
                )}
                onChange={(assignmentId) => {
                  const assignment = selectedAddWorker?.assignments?.find(
                    (a: any) => a.id === assignmentId,
                  );
                  if (assignment)
                    addForm.setFieldsValue({
                      company:
                        assignment.workingFactory ||
                        assignment.interviewFactory ||
                        "",
                      interviewDate: assignment.interviewDate || "",
                      workerCode:
                        assignment.employeeCode ||
                        selectedAddWorker?.code ||
                        "",
                    });
                }}
              />
            </Form.Item>
            <Form.Item
              name="month"
              label="Tháng"
              rules={[{ required: true, message: "Vui lòng chọn tháng" }]}
            >
              <Select
                disabled={!!editing}
                showSearch
                options={MONTHS.map((m) => ({ label: m, value: m }))}
              />
            </Form.Item>
            <Form.Item
              name="company"
              label="Công ty"
              rules={[{ required: true, message: "Vui lòng nhập công ty" }]}
            >
              <Input placeholder="Công ty / nhà máy" />
            </Form.Item>
            <Form.Item name="interviewDate" label="Ngày PV">
              <Input placeholder="dd/mm/yyyy" />
            </Form.Item>
            <Form.Item name="policy" label="Chính sách">
              <Input placeholder="Nhập chính sách áp dụng" />
            </Form.Item>
            <Form.Item name="workerCode" label="Mã nhân viên">
              <Input placeholder="Mã nhân viên" />
            </Form.Item>
            <Form.Item name="accountNumber" label="STK">
              <Input placeholder="Số tài khoản" />
            </Form.Item>
            <Form.Item name="bankName" label="Ngân hàng">
              <Input placeholder="Tên ngân hàng" />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button
              onClick={() => {
                setIsAddModalOpen(false);
                setEditing(null);
              }}
            >
              Hủy
            </Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              Lưu Bản Ghi Thưởng
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
