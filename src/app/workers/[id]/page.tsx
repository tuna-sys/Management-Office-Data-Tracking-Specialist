"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Card,
  Descriptions,
  Table,
  Tag,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Timeline,
  message,
  Alert,
} from "antd";
import { useIdentity } from "@/components/AuthGate";
import AssignmentFields from "@/components/AssignmentFields";
import DateField from "@/components/DateField";
import { formatDate } from "@/lib/date-format";

export default function WorkerDetailPage() {
  const { id } = useParams<{ id: string }>(),
    user = useIdentity(),
    canWrite = user?.permissions.includes("worker:write");
  const [worker, setWorker] = useState<any>(null),
    [edit, setEdit] = useState<any>(null),
    [statuses, setStatuses] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [form] = Form.useForm();
  async function load() {
    const j = await (
      await fetch("/api/worker-history?" + new URLSearchParams({ id }))
    ).json();
    if (j.success) setWorker(j.data[0] || null);
    else message.error(j.message);
  }
  useEffect(() => {
    load().catch(() => message.error("Không tải được hồ sơ"));
    fetch("/api/catalogs?kind=STATUS")
      .then((r) => r.json())
      .then((j) => setStatuses(j.data || []));
  }, [id]);
  function show(a: any) {
    setEdit(a);
    form.resetFields();
    form.setFieldsValue({
      ...a,
      ...Object.fromEntries(
        [
          "fullName",
          "idCard",
          "phone",
          "dob",
          "gender",
          "idCardDate",
          "idCardPlace",
          "address",
          "province",
          "code",
        ].map((k) => [k, worker[k]]),
      ),
      confirmedWorkDays: undefined,
      workDaysAsOf: undefined,
      eventNote: "",
    });
  }
  async function save(values: any) {
    setBusy(true);
    try {
      const j = await (
        await fetch(`/api/workers/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...values,
            assignmentId: edit.id,
            assignmentUpdatedAt: edit.updatedAt,
            updatedAt: worker.updatedAt,
          }),
        })
      ).json();
      if (j.success) {
        setEdit(null);
        await load();
      } else message.error(j.message);
    } catch {
      message.error("Không lưu được hồ sơ");
    } finally {
      setBusy(false);
    }
  }
  if (!worker)
    return <Alert type="info" message="Đang tải hoặc không tìm thấy hồ sơ" />;

  return (
    <div className="space-y-5">
      <Card
        title={
          <div className="flex items-center justify-between">
            <span>{worker.fullName}</span>
            <Tag color="blue">
              {worker.assignments?.length || 1} công ty từng làm việc
            </Tag>
          </div>
        }
      >
        <Descriptions
          column={{ xs: 1, sm: 2, lg: 3 }}
          items={Object.entries({
            CCCD: worker.idCard,
            "Mã hồ sơ": worker.code || "—",
            "Ngày sinh": formatDate(worker.dob),
            "Giới tính": worker.gender || "—",
            SĐT: worker.phone || "—",
            "Quê quán/Tỉnh": worker.province || "Chưa xác định",
            "Địa chỉ": worker.address || "—",
          }).map(([label, children]) => ({
            key: label,
            label,
            children: children as string,
          }))}
        />
      </Card>

      <h2 className="text-lg font-bold text-slate-800">
        Lịch sử chi tiết các công ty đã làm việc (
        {worker.assignments?.length || 0})
      </h2>

      {worker.assignments.map((a: any, aIdx: number) => {
        const paymentsTotal = (a.enrollments || []).reduce(
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
        const bonusTotal = (a.bonusRecords || []).reduce(
          (sum: number, b: any) => sum + (b.totalBonus || 0),
          0,
        );
        const totalCompanyBonus =
          paymentsTotal > 0 ? paymentsTotal : bonusTotal;

        return (
          <Card
            key={a.id}
            title={
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Lượt {worker.assignments.length - aIdx}:{" "}
                  <strong>{a.workingFactory || a.interviewFactory}</strong> ·{" "}
                  {a.order?.name || "Chưa gán đơn hàng"}
                </span>
                <div className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                  Thưởng đã nhận: {totalCompanyBonus.toLocaleString("vi-VN")} đ
                </div>
              </div>
            }
            extra={
              <Button disabled={!canWrite} onClick={() => show(a)}>
                Sửa đợt / chốt công
              </Button>
            }
          >
            <Descriptions
              column={{ xs: 1, sm: 2, lg: 3 }}
              items={[
                {
                  key: "pv",
                  label: "Ngày PV",
                  children: formatDate(a.interviewDate),
                },
                {
                  key: "result",
                  label: "Kết quả PV",
                  children: (
                    {
                      PASS: "Đỗ",
                      FAIL: "Trượt",
                      ABANDONED: "Bỏ",
                      PENDING: "Chờ kết quả",
                      UNKNOWN: "Chưa xác nhận",
                    } as any
                  )[a.interviewResult],
                },
                {
                  key: "passed",
                  label: "Ngày đỗ",
                  children: formatDate(a.passedDate),
                },
                {
                  key: "start",
                  label: "Ngày bắt đầu làm",
                  children: formatDate(a.startDate),
                },
                {
                  key: "left",
                  label: "Ngày nghỉ",
                  children: formatDate(a.leaveDate),
                },
                {
                  key: "reason",
                  label: "Lý do nghỉ việc",
                  children: a.leaveReason ? (
                    <span className="text-rose-600 font-semibold">
                      {a.leaveReason}
                    </span>
                  ) : (
                    "—"
                  ),
                },
                {
                  key: "status",
                  label: "Trạng thái",
                  children: (
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
                  ),
                },
                {
                  key: "shuttleBusKtx",
                  label: "Đón xe + KTX",
                  children: a.shuttleBusKtx || "—",
                },
                {
                  key: "expectedTrainingDate",
                  label: "Ngày đào tạo dự kiến",
                  children: formatDate(a.expectedTrainingDate),
                },
                {
                  key: "expectedTrainingStatus",
                  label: "Tình trạng đào tạo",
                  children: a.expectedTrainingStatus || "—",
                },
                {
                  key: "code",
                  label: "Mã NV tại công ty",
                  children: a.employeeCode || "—",
                },
                {
                  key: "rec",
                  label: "Tuyển dụng / Team",
                  children: `${a.recruiter || "—"} / ${a.team || "—"}`,
                },
                {
                  key: "days",
                  label: "Công đã xác nhận",
                  children:
                    a.confirmedWorkDays == null
                      ? "Chưa chốt"
                      : `${a.confirmedWorkDays} công, chốt ${formatDate(a.workDaysAsOf)} (${a.workDaysConfirmedBy})`,
                },
              ]}
            />

            <h3 className="font-bold mt-5 mb-3">Lịch sử cập nhật trạng thái</h3>
            {a.events.length ? (
              <Timeline
                items={a.events.map((e: any) => ({
                  children: `${formatDate(e.occurredOn)}: ${e.fromStatus ? e.fromStatus + " → " : ""}${e.toStatus} · ${e.operator}${e.note ? " · " + e.note : ""}`,
                }))}
              />
            ) : (
              <p className="text-slate-500 text-xs">
                Dữ liệu cũ chưa có lịch sử chuyển trạng thái được xác nhận.
              </p>
            )}

            {a.enrollments.map((e: any) => (
              <div key={e.id} className="mt-4">
                <h3 className="font-semibold text-sm">
                  {e.factory} · {e.policyName} ({formatDate(e.effectiveFrom)} →{" "}
                  {formatDate(e.effectiveTo)})
                </h3>
                <Table<any>
                  rowKey="id"
                  pagination={false}
                  size="small"
                  dataSource={e.stages}
                  columns={[
                    { title: "Mốc", dataIndex: "label" },
                    {
                      title: "Điều kiện",
                      render: (_, s) =>
                        s.thresholdDays == null
                          ? "Thủ công"
                          : `${s.thresholdDays} công`,
                    },
                    {
                      title: "Mức thưởng",
                      dataIndex: "amount",
                      render: (v) => v.toLocaleString("vi-VN"),
                    },
                    {
                      title: "Xét / đạt",
                      render: (_, s) =>
                        `${s.eligible ? "Đủ điều kiện" : "Chưa xác nhận"} · ${s.achieved ? "Đạt" : "Chưa đạt"}`,
                    },
                    {
                      title: "Đã trả",
                      render: (_, s) =>
                        s.payments
                          .reduce((n: number, p: any) => n + p.amount, 0)
                          .toLocaleString("vi-VN"),
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
                          {
                            title: "Tiền",
                            dataIndex: "amount",
                            render: (v: number) =>
                              v.toLocaleString("vi-VN") + " đ",
                          },
                          { title: "Chứng từ", dataIndex: "reference" },
                          { title: "Người xác nhận", dataIndex: "confirmedBy" },
                        ]}
                      />
                    ),
                  }}
                />
              </div>
            ))}

            {a.bonusRecords.length > 0 && (
              <Alert
                className="mt-4"
                type="info"
                message={`Có ${a.bonusRecords.length} bản ghi thưởng cũ (Tổng: ${bonusTotal.toLocaleString("vi-VN")} đ); không tự coi là đã lĩnh khi thiếu chứng từ.`}
              />
            )}
            <div className="mt-2">
              <a
                className="text-blue-600 text-xs font-semibold"
                href={`/rewards?assignmentId=${a.id}`}
              >
                Theo dõi mốc thưởng và từng lần chi trả chi tiết →
              </a>
            </div>
          </Card>
        );
      })}

      <Modal
        title="Cập nhật hồ sơ và đợt tuyển"
        open={!!edit}
        onCancel={() => setEdit(null)}
        footer={null}
        width={800}
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries({
              fullName: "Họ tên",
              idCard: "CCCD",
              phone: "SĐT",
              dob: "Ngày sinh",
              gender: "Giới tính",
              idCardDate: "Ngày cấp",
              idCardPlace: "Nơi cấp",
              province: "Quê quán/Tỉnh",
              address: "Địa chỉ",
              code: "Mã hồ sơ",
              recruiter: "Tuyển dụng",
              team: "Đội nhóm",
              source: "Nguồn tuyển dụng",
              interviewFactory: "Nhà máy PV",
              workingFactory: "Nhà máy làm việc",
              contractType: "Loại hợp đồng",
              shuttleBusKtx: "Đón xe / KTX",
              interviewDate: "Ngày PV",
              expectedTrainingDate: "Ngày đào tạo dự kiến",
              expectedTrainingStatus: "Tình trạng đào tạo",
              standardTrainingDate: "Ngày đào tạo chuẩn",
              onboardingMonth: "Tháng nhận việc",
              leaveDate: "Ngày nghỉ",
              leaveReason: "Lý do nghỉ",
            }).map(([name, label]) => (
              <Form.Item key={name} name={name} label={label}>
                {[
                  "dob",
                  "idCardDate",
                  "interviewDate",
                  "expectedTrainingDate",
                  "standardTrainingDate",
                  "leaveDate",
                ].includes(name) ? (
                  <DateField />
                ) : (
                  <Input />
                )}
              </Form.Item>
            ))}
          </div>
          <Form.Item name="status" label="Trạng thái">
            <Select
              options={statuses
                .filter((s) => s.isActive)
                .map((s) => ({ value: s.name, label: s.name }))}
            />
          </Form.Item>
          <AssignmentFields form={form} showWorkDays />
          <Form.Item
            name="eventDate"
            label="Ngày cập nhật trạng thái (để trống = hôm nay)"
          >
            <DateField />
          </Form.Item>
          <Form.Item name="eventNote" label="Ghi chú / căn cứ chốt công">
            <Input.TextArea />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            Lưu xác nhận thủ công
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
