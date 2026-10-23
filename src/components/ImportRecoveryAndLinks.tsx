"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import { formatDate } from "@/lib/date-format";
const states: Record<string, string> = {
  MATCHED: "Khớp lượt tuyển", NO_ASSIGNMENT: "Chưa có lượt tuyển", NO_WORKER: "Chưa có hồ sơ", SOURCE_CONFLICT: "Xung đột dòng nguồn",
  IDENTITY_CONFLICT: "Sai lệch danh tính", COMPANY_CONFLICT: "Khác công ty", CODE_CONFLICT: "Khác mã nhân viên", AMBIGUOUS: "Nhiều lượt cùng ngày",
  MISSING_DATE: "Thiếu ngày PV", MISSING_COMPANY: "Thiếu công ty",
};
const recoveryLabels: Record<string,string> = { RECOVERABLE: "Đã ghi, còn thiếu snapshot nguồn", RETRYABLE: "Chưa ghi, có thể thử lại", RUNNING: "Đang xử lý", NEEDS_REVIEW: "Cần kiểm tra nhật ký" };
export default function ImportRecoveryAndLinks({ refreshToken }: { refreshToken: number }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [recovering, setRecovering] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string,number>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [linking, setLinking] = useState("");
  const controller = useRef<AbortController | null>(null);
  async function loadRuns() {
    try { const response = await fetch("/api/excel-engine/recovery", { cache: "no-store" }); const result = await response.json();
      if (result.success) setRuns(result.data.filter((r: any) => r.state !== "COMPLETED"));
    } catch { message.error("Không tải được danh sách phiên phục hồi"); }
  }
  useEffect(() => { loadRuns(); }, [refreshToken]);
  useEffect(() => () => controller.current?.abort(), []);
  async function recover(runId: string) {
    setRecovering(runId);
    try { const response = await fetch("/api/excel-engine/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "RECOVER", importRunId: runId, confirm: true }) });
      const result = await response.json(); if (!result.success) throw new Error(result.message);
      message.success("Đã hoàn tất snapshot nguồn của phiên; không ghi lặp dữ liệu nghiệp vụ"); await loadRuns();
    } catch (error: any) { message.error(error.message || "Không phục hồi được phiên"); }
    finally { setRecovering(""); }
  }
  async function loadLinks(nextPage = page, nextState = state) {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setLoading(true);
    try { const query = new URLSearchParams({ page: String(nextPage), pageSize: "10", state: nextState });
      const response = await fetch("/api/source-reconciliation?" + query, { signal: request.signal, cache: "no-store" }); const result = await response.json();
      if (request.signal.aborted) return; if (!result.success) throw new Error(result.message);
      setRows(result.data); setTotal(result.total); setCounts(result.counts); setPage(result.page); setLoaded(true);
    } catch (error: any) { if (!request.signal.aborted) message.error(error.message || "Không đối chiếu được nguồn"); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }
  async function link(row: any) {
    const key = row.sourceId + ":" + row.row; setLinking(key);
    try { const response = await fetch("/api/source-reconciliation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "LINK_BONUSES", confirm: true, items: [{ sourceId: row.sourceId, row: row.row, assignmentId: row.assignmentId, linkToken: row.linkToken }] }) });
      const result = await response.json(); if (!result.success) throw new Error(result.message);
      message.success(result.linkedCount ? "Đã liên kết bản thưởng với đúng lượt tuyển và lưu lịch sử" : "Bản thưởng đã có đúng liên kết; không ghi lại"); await loadLinks();
    } catch (error: any) { message.error(error.message || "Không liên kết được nguồn"); }
    finally { setLinking(""); }
  }
  return <div className="space-y-4">
    {runs.length > 0 && <Card title="Phiên import cần xử lý" size="small">
      <Alert type="warning" showIcon message="Nếu đã ghi dữ liệu nhưng thiếu snapshot nguồn, dùng Phục hồi. Phiên chưa ghi cần tải lại nguồn và quét trước khi thử lại." />
      <Table rowKey="runId" size="small" dataSource={runs} pagination={false} columns={[
        { title: "Mã phiên", dataIndex: "runId", ellipsis: true },
        { title: "Trạng thái", render: (_: any,r: any) => recoveryLabels[r.state] || r.state },
        { title: "Thao tác", render: (_: any,r: any) => <Popconfirm title="Hoàn tất snapshot nguồn cho phiên đã ghi?" onConfirm={() => recover(r.runId)} disabled={r.state !== "RECOVERABLE"}>
          <Button disabled={r.state !== "RECOVERABLE"} loading={recovering === r.runId}>Phục hồi</Button></Popconfirm> },
      ]} />
    </Card>}
    <Card title="Đối chiếu nguồn với lượt tuyển" size="small" extra={<Button loading={loading} onClick={() => loadLinks(1)}>Đối chiếu / Tải lại</Button>}>
      <p className="text-sm text-slate-600 mb-3">Đối chiếu CCCD, ngày phỏng vấn, công ty và mã nhân viên. Dòng thiếu lượt tuyển cần bổ sung dữ liệu tuyển dụng đã xác minh. Liên kết chỉ gắn bản thưởng hiện có, không tạo lượt tuyển mới.</p>
      {loaded && <>
        <Space wrap className="mb-3"><Select value={state} style={{ minWidth: 240 }} onChange={value => { setState(value); loadLinks(1,value); }} options={[{ value: "", label: "Tất cả trạng thái" }, ...Object.entries(counts).map(([key,count]) => ({ value:key, label:(states[key] || key) + " (" + count.toLocaleString("vi-VN") + ")" }))]} /></Space>
        <Table rowKey={r => r.sourceId + ":" + r.row} loading={loading} dataSource={rows} size="small" scroll={{ x: 1000 }} pagination={{ current:page, pageSize:10, total, showSizeChanger:false, onChange:next => loadLinks(next), showTotal:n => n.toLocaleString("vi-VN") + " dòng" }} columns={[
          { title:"Nguồn / Dòng", render:(_:any,r:any) => r.file + " / " + r.row, width:200 },
          { title:"Họ tên", dataIndex:"fullName", width:160 }, { title:"Công ty", dataIndex:"company", width:130 },
          { title:"Ngày PV", dataIndex:"interviewDate", render:formatDate, width:100 },
          { title:"Kết quả", render:(_:any,r:any) => <><Tag color={r.state === "MATCHED" ? "green" : "orange"}>{states[r.state] || r.state}</Tag><div className="text-xs text-slate-500">{r.reason}</div></> },
          { title:"Thao tác", width:140, render:(_:any,r:any) => <Popconfirm title="Liên kết bản thưởng với lượt tuyển đã đối chiếu?" description="Giữ nguyên số tiền và dữ liệu nguồn." onConfirm={() => link(r)} disabled={r.type !== "DS_THUONG" || r.state !== "MATCHED"}>
            <Button size="small" disabled={r.type !== "DS_THUONG" || r.state !== "MATCHED"} loading={linking === r.sourceId + ":" + r.row}>Liên kết thưởng</Button></Popconfirm> },
        ]} />
      </>}
    </Card>
  </div>;
}
