"use client";

import React, { useState } from "react";
import { Alert, Button, Input, Modal, Table, message } from "antd";

export type EditableField = { key: string; label: string; before: string; source: string; kind?: string };
type Decision = { mode: "KEEP" | "SOURCE" | "CUSTOM"; value: string };
type Item = { id: string; sourceId?: string; row?: number; targetAssignmentId?: string | null; fullName: string;
  fileName?: string; editableFields?: EditableField[]; editReviewToken?: string };

export default function DuplicateReviewEditor({ item, onSaved }: { item: Item; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Array<EditableField & {after: string}> | null>(null);
  const [changeCount, setChangeCount] = useState(0);
  const fields = item.editableFields || [];
  const available = !!item.sourceId && !!item.targetAssignmentId && !!item.editReviewToken && fields.length > 0;
  const show = (value: string) => value || "—";
  const begin = () => {
    setDecisions(Object.fromEntries(fields.map(f => [f.key, { mode: "KEEP", value: f.before }])));
    setNote(""); setPreview(null); setChangeCount(0); setOpen(true);
  };
  const update = (key: string, next: Partial<Decision>) => {
    setDecisions(current => ({ ...current, [key]: { ...current[key], ...next } }));
    setPreview(null);
  };
  const request = async (save: boolean) => {
    if (save && !note.trim()) { message.warning("Anh cần ghi lý do duyệt trước khi lưu."); return; }
    if (save && !preview) return;
    setBusy(true);
    try {
      const response = await fetch("/api/duplicates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        id: item.id, action: "APPROVE", sourceId: item.sourceId, row: item.row,
        targetAssignmentId: item.targetAssignmentId, editReviewToken: item.editReviewToken,
        resolution: save ? "EDIT_AND_APPROVE" : "PREVIEW_EDIT", confirmResolution: true, reviewerNote: note,
        fieldDecisions: fields.map(f => ({ key: f.key, ...decisions[f.key] })),
      }) });
      const result = await response.json();
      if (!response.ok || !result.success) { setPreview(null); message.error(result.message || "Không thể kiểm tra hoặc lưu quyết định"); return; }
      if (save) { message.success(result.message); setOpen(false); await onSaved(); }
      else { setPreview(result.data.previewFields); setChangeCount(result.data.changeCount); }
    } catch { setPreview(null); message.error("Không kết nối được máy chủ; chưa xác nhận lưu thành công. Hãy tải lại danh sách trước khi thử lại."); }
    finally { setBusy(false); }
  };
  return <>
    <Button disabled={!available} title={available ? "Nhập trực tiếp thông tin cần sửa trước khi duyệt" : "Cần một hồ sơ và đúng một lượt tuyển để chỉnh sửa"} onClick={begin}>Chỉnh sửa & duyệt</Button>
    <Modal open={open} title={preview ? "Xem trước thông tin sau khi duyệt" : "Chỉnh sửa & duyệt từng trường"}
      width="min(1350px, calc(100vw - 32px))" style={{ top: 16 }} styles={{ body: { maxHeight: "calc(100dvh - 190px)", overflowY: "auto" } }}
      onCancel={() => { if (!busy) setOpen(false); }} closable={!busy} maskClosable={false}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <Button disabled={busy} onClick={() => setOpen(false)}>Hủy</Button>
        {preview ? <><Button disabled={busy} onClick={() => setPreview(null)}>Quay lại chỉnh sửa</Button><Button type="primary" loading={busy} disabled={!note.trim()} onClick={() => request(true)}>Lưu & duyệt</Button></>
          : <Button type="primary" loading={busy} onClick={() => request(false)}>Xem trước</Button>}
      </div>}>
      <div className="space-y-3">
        <p><strong>{item.fullName}</strong> · {item.fileName} · Dòng {item.row}</p>
        <Alert type="info" showIcon message={preview ? ("Có " + changeCount + " trường thay đổi. Chưa lưu vào hồ sơ.") : "Sửa trực tiếp trong cột Thông tin sau chỉnh sửa. Các ô được điền sẵn thông tin hiện có; ô không sửa sẽ giữ nguyên."}
          description="Luồng này sửa lượt tuyển đang đối chiếu. Khi lưu, dòng nhập được đánh dấu đã xử lý và lịch sử trước/sau được lưu; Google Sheets không thay đổi." />
        <Table rowKey="key" pagination={false} size="small" scroll={{ x: preview ? 700 : 1080 }}
          dataSource={preview || fields}
          rowClassName={f => preview && (f as EditableField & {after: string}).after !== f.before ? "bg-amber-50" : ""}
          columns={preview ? [
            { title: "Trường thông tin", dataIndex: "label", width: 180 },
            { title: "Hiện có", dataIndex: "before", render: show },
            { title: "Sau khi duyệt", render: (_, f) => show((f as EditableField & {after: string}).after) },
          ] : [
            { title: "Trường thông tin", dataIndex: "label", width: 175 },
            { title: "Hiện có", dataIndex: "before", width: 240, render: show },
            { title: "Dữ liệu nguồn", dataIndex: "source", width: 240, render: show },
            { title: "Thông tin sau chỉnh sửa", width: 340, render: (_, f) => <Input.TextArea
              aria-label={"Chỉnh sửa: " + f.label} disabled={busy} maxLength={2000} autoSize={{ minRows: 1, maxRows: 4 }}
              value={decisions[f.key]?.value ?? f.before}
              placeholder={f.kind === "date" ? "dd/mm/yyyy hoặc yyyy-mm-dd" : f.kind === "month" ? "Tháng 05/2026" : "Nhập thông tin"}
              onChange={event => update(f.key, { mode: event.target.value === f.before ? "KEEP" : "CUSTOM", value: event.target.value })} /> },
          ]} />
        <label className="block font-medium" htmlFor="reviewer-edit-note">Lý do duyệt</label>
        <Input.TextArea id="reviewer-edit-note" disabled={busy} maxLength={1000} showCount rows={2} value={note}
          placeholder="Ghi căn cứ xác minh và lý do giữ hoặc thay đổi thông tin" onChange={event => setNote(event.target.value)} />
      </div>
    </Modal>
  </>;
}
