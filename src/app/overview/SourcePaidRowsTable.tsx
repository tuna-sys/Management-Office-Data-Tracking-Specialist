"use client";
import React, { useEffect, useRef, useState } from "react";
import { Table, message } from "antd";

export default function SourcePaidRowsTable({ filters, search }: { filters: Record<string, unknown>; search: string }) {
  const [rows, setRows] = useState<any[]>([]), [total, setTotal] = useState(0);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [busy, setBusy] = useState(false);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) { if (value.length) query.set(key, value.join(",")); }
    else if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  query.set("tableSearch", search);
  const filterKey = query.toString();
  const previous = useRef(filterKey);
  useEffect(() => {
    if (previous.current !== filterKey) { previous.current = filterKey; if (page !== 1) { setPage(1); return; } }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      const params = new URLSearchParams(filterKey); params.set("view", "sourceRows"); params.set("page", String(page)); params.set("pageSize", String(pageSize));
      try {
        const response = await fetch("/api/reports?" + params, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || !result.success) throw new Error(result.message || "Không tải được chi tiết thưởng");
        setRows(result.data.rows); setTotal(result.data.filteredTotal); setPage(result.data.page);
      } catch (error: any) { if (!controller.signal.aborted) message.error(error.message || "Không tải được chi tiết thưởng"); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filterKey, page, pageSize]);
  return <Table rowKey={row => String(row.id)} loading={busy} size="small" dataSource={rows} scroll={{ x: 1100 }}
    pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: ["20", "50", "100"], onChange: (next, size) => { setPage(next); setPageSize(size); } }}
    columns={[
      { title: "Người lao động", dataIndex: "name" }, { title: "Số CCCD", dataIndex: "idCard" },
      { title: "Công ty", dataIndex: "company" }, { title: "Tháng thưởng", dataIndex: "month" },
      { title: "Đã chi trả", dataIndex: "paid", render: amount => (amount || 0).toLocaleString("vi-VN") + " ₫" },
      { title: "Ngày PV ghi nhận", dataIndex: "interviewDate" }, { title: "Chính sách thưởng", dataIndex: "policy" },
      { title: "Chi tiết các lần thưởng 1 → 7", dataIndex: "sourceRewards" },
    ]} />;
}
