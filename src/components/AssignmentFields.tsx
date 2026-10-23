"use client";
import { useEffect, useState } from "react";
import { Form, Input, Select, InputNumber, AutoComplete } from "antd";
import DateField from "@/components/DateField";
import { formatDate } from "@/lib/date-format";
export default function AssignmentFields({
  form,
  showWorkDays = false,
}: {
  form: any;
  showWorkDays?: boolean;
}) {
  const [orders, setOrders] = useState<any[]>([]),
    [factories, setFactories] = useState<any[]>([]),
    [recruiters, setRecruiters] = useState<any[]>([]),
    [teams, setTeams] = useState<any[]>([]),
    [statuses, setStatuses] = useState<any[]>([]);
  const orderId = Form.useWatch("orderId", form),
    recruiterId = Form.useWatch("recruiterId", form),
    result = Form.useWatch("interviewResult", form),
    interviewFactory = Form.useWatch("interviewFactory", form),
    status = Form.useWatch("status", form);
  useEffect(() => {
    Promise.all([
      fetch("/api/orders").then((r) => r.json()),
      fetch("/api/catalogs?kind=FACTORY").then((r) => r.json()),
      fetch("/api/catalogs?kind=RECRUITER").then((r) => r.json()),
      fetch("/api/catalogs?kind=TEAM").then((r) => r.json()),
      fetch("/api/catalogs?kind=STATUS").then((r) => r.json()),
    ])
      .then(([o, f, r, t, s]) => {
        setOrders(o.data || []);
        setFactories(f.data || []);
        setRecruiters(r.data || []);
        setTeams(t.data || []);
        setStatuses(s.data || []);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!factories.length) return;
    const findId = (name: string) => factories.find((f) => f.name.trim().toLocaleLowerCase("vi") === String(name || "").trim().toLocaleLowerCase("vi"))?.id;
    if (!form.getFieldValue("interviewFactoryId") && interviewFactory) {
      const id = findId(interviewFactory);
      if (id) form.setFieldValue("interviewFactoryId", id);
    }
  }, [factories, form, interviewFactory]);
  useEffect(() => {
    if (!statuses.length || !status || form.getFieldValue("statusId")) return;
    const match = statuses.find((s) => s.name === status);
    if (match) form.setFieldValue("statusId", match.id);
  }, [statuses, form, status]);
  const order = orders.find((o) => o.id === orderId);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Form.Item name="interviewFactoryId" hidden><Input /></Form.Item>
      <Form.Item name="workingFactoryId" hidden><Input /></Form.Item>
      <Form.Item name="status" hidden><Input /></Form.Item>
      <Form.Item name="recruiter" hidden><Input /></Form.Item>
      <Form.Item name="team" hidden><Input /></Form.Item>
      <Form.Item name="interviewFactory" label="Nhà máy phỏng vấn" rules={[{ required: true, whitespace: true, message: "Nhập nhà máy phỏng vấn" }]}>
        <AutoComplete options={factories.filter((f) => f.isActive).map((f) => ({ value: f.name, label: f.name }))} filterOption={(value, option) => String(option?.value || "").toLocaleLowerCase("vi").includes(value.toLocaleLowerCase("vi"))} onChange={(name) => {
          const match = factories.find((f) => f.name.trim().toLocaleLowerCase("vi") === name.trim().toLocaleLowerCase("vi"));
          form.setFieldValue("interviewFactoryId", match?.id || "");
        }} />
      </Form.Item>
      <Form.Item name="workingFactory" label="Nhà máy làm việc (không bắt buộc)">
        <Input allowClear placeholder="Có thì ghi nhận, không có để trống" onChange={() => form.setFieldValue("workingFactoryId", "")} />
      </Form.Item>
      <Form.Item name="statusId" label="Tình trạng làm việc" rules={[{ required: true, message: "Chọn tình trạng" }]}>
        <Select showSearch optionFilterProp="label" options={statuses.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))} onChange={(id) => {
          const s = statuses.find((x) => x.id === id);
          form.setFieldsValue({ status: s?.name || "", statusId: id || "" });
        }} />
      </Form.Item>
      <Form.Item name="orderId" label="Đơn hàng">
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          options={orders
            .filter((o) => o.isActive)
            .map((o) => ({
              value: o.id,
              label: `${o.factory} · ${o.code} · ${o.name}`,
            }))}
          onChange={(id) => {
            const o = orders.find((o) => o.id === id);
            form.setFieldsValue({
              batchId: undefined,
              ...(o ? {
                interviewFactory: o.factoryEntry?.name || o.factory,
                interviewFactoryId: o.factoryId || undefined,
              } : {}),
            });
          }}
        />
      </Form.Item>
      <Form.Item name="batchId" label="Đợt tuyển">
        <Select
          allowClear
          disabled={!orderId}
          options={(order?.batches || []).map((b: any) => ({
            value: b.id,
            label: `${b.code} · ${b.name} (${formatDate(b.startDate)} → ${formatDate(b.endDate)})`,
          }))}
        />
      </Form.Item>
      <Form.Item name="employeeCode" label="Mã nhân viên tại công ty">
        <Input />
      </Form.Item>
      <Form.Item name="recruiterId" label="Chuyên viên tuyển dụng">
        <Select
          allowClear
          options={recruiters
            .filter((r) => r.isActive)
            .map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))}
          onChange={(id) => {
            const r = recruiters.find((r) => r.id === id);
            form.setFieldsValue({
              recruiterId: id || "",
              teamId: r?.teamId || "",
              recruiter: r?.name || "",
              team: r?.team?.name || "",
            });
          }}
        />
      </Form.Item>
      <Form.Item name="teamId" label="Team phụ trách">
        <Select
          allowClear={!recruiterId}
          disabled={Boolean(recruiterId)}
          options={teams
            .filter((t) => t.isActive && (!recruiterId || t.id === recruiters.find((r) => r.id === recruiterId)?.teamId))
            .map((t) => ({ value: t.id, label: t.name }))}
          onChange={(id) => {
            const t = teams.find((x) => x.id === id);
            form.setFieldsValue({ teamId: id || "", team: t?.name || "" });
          }}
        />
      </Form.Item>
      <Form.Item name="interviewResult" label="Kết quả phỏng vấn">
        <Select
          allowClear
          options={[
            { value: "UNKNOWN", label: "Chưa xác nhận" },
            { value: "PENDING", label: "Chờ kết quả" },
            { value: "PASS", label: "Đỗ" },
            { value: "FAIL", label: "Trượt" },
            { value: "ABANDONED", label: "Bỏ phỏng vấn" },
          ]}
        />
      </Form.Item>
      <Form.Item
        name="passedDate"
        label="Ngày phỏng vấn đỗ"
        rules={result === "PASS" ? [{ required: true }] : []}
      >
        <DateField />
      </Form.Item>
      <Form.Item name="startDate" label="Ngày bắt đầu làm (sau ngày đỗ)">
        <DateField />
      </Form.Item>
      {showWorkDays && (
        <>
          <Form.Item
            name="confirmedWorkDays"
            label="Số công thực tế đã xác nhận"
          >
            <InputNumber min={0} max={10000} step={0.5} className="w-full" />
          </Form.Item>
          <Form.Item name="workDaysAsOf" label="Ngày chốt số công">
            <DateField />
          </Form.Item>
        </>
      )}
    </div>
  );
}
