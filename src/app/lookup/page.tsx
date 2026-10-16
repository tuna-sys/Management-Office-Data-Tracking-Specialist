"use client";

import React, { useState } from "react";
import { formatDate } from "@/lib/date-format";
import { Card, Input, Button, Form, message, Tag, Table, Divider } from "antd";
import {
  Search,
  Building2,
  Coins,
  CreditCard,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Briefcase,
  FileText,
} from "lucide-react";

export default function LookupPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [form] = Form.useForm();

  const handleLookup = async (values: any) => {
    const idCard = values?.idCard?.trim() || "";
    const code = values?.code?.trim() || "";
    if (!idCard && !code) {
      message.warning("Vui lòng nhập Số CCCD hoặc Mã Nhân Viên để tra cứu");
      return;
    }
    try {
      setLoading(true);
      setResult(null);
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idCard, code }),
      });
      const json = await res.json();
      if (json.success) {
        setResult(json.data);
      } else {
        message.error(json.message);
      }
    } catch (err) {
      message.error("Lỗi kết nối tra cứu");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-6 px-3">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex p-3 rounded-2xl bg-blue-100 text-blue-600 mb-2">
          <Search className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-black text-slate-900">
          Cổng Tra Cứu Hồ Sơ & Lịch Sử Làm Việc Đa Công Ty
        </h1>
        <p className="text-xs text-slate-500 max-w-lg mx-auto">
          Tra cứu toàn bộ lịch sử các công ty/nhà máy từng làm việc qua hệ
          thống, ngày bắt đầu, ngày nghỉ, và chi tiết các khoản thưởng đã nhận.
        </p>
      </div>

      {/* Tra cứu Form */}
      <Card className="shadow-md border-slate-200 rounded-2xl">
        <Form form={form} layout="vertical" onFinish={handleLookup}>
          <Form.Item
            name="idCard"
            label="Số Thẻ Căn Cước Công Dân (CCCD)"
          >
            <Input
              size="large"
              allowClear
              placeholder="Nhập 12 chữ số CCCD hoặc 9 số CMT..."
            />
          </Form.Item>

          <div className="relative flex items-center justify-center my-2">
            <div className="border-t border-slate-200 w-full" />
            <span className="bg-white px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
              Hoặc tra cứu bằng
            </span>
            <div className="border-t border-slate-200 w-full" />
          </div>

          <Form.Item
            name="code"
            label="Mã Nhân Viên (Mã NV)"
            extra="Chỉ cần nhập 1 trong 2 thông tin (Số CCCD hoặc Mã Nhân Viên) để tra cứu nhanh hồ sơ."
          >
            <Input
              size="large"
              allowClear
              placeholder="Ví dụ: V3910429..."
            />
          </Form.Item>

          <Button
            type="primary"
            size="large"
            htmlType="submit"
            loading={loading}
            block
            className="mt-2 bg-blue-600 hover:bg-blue-500 font-bold h-11"
          >
            Tra Cứu Thông Tin Hồ Sơ Ngay
          </Button>
        </Form>
      </Card>

      {/* Kết Quả Tra Cứu */}
      {result && (
        <div className="space-y-6 animate-fade-in">
          {/* Card Thông Tin Chung Của Người Lao Động */}
          <Card className="shadow-md border-blue-200 bg-white rounded-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Hồ sơ người lao động
                </span>
                <h2 className="text-2xl font-black text-slate-900 mt-0.5">
                  {result.fullName}
                </h2>
                <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-3">
                  {result.code && (
                    <span>
                      Mã NV:{" "}
                      <strong className="font-mono text-blue-700">
                        {result.code}
                      </strong>
                    </span>
                  )}
                  {(result.idCardDisplay || result.idCard || form.getFieldValue("idCard")) && (
                    <span>
                      CCCD:{" "}
                      <strong className="font-mono text-slate-700">
                        {result.idCardDisplay || result.idCard || form.getFieldValue("idCard")}
                      </strong>
                    </span>
                  )}
                  {result.phone && (
                    <span>
                      SĐT:{" "}
                      <strong className="font-mono text-slate-700">
                        {result.phone}
                      </strong>
                    </span>
                  )}
                </div>
              </div>

              <div className="text-left sm:text-right">
                <Tag
                  color="blue"
                  className="text-sm px-3 py-1 font-semibold rounded-full"
                >
                  Đã làm việc tại {result.companies?.length || 1} công ty / nhà
                  máy
                </Tag>
              </div>
            </div>

            {/* Tài khoản nhận thưởng */}
            <div className="mt-4 bg-slate-50 p-3.5 rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-slate-400">
                    Tài khoản ngân hàng nhận tiền thưởng
                  </div>
                  <div className="font-bold text-slate-800 text-sm mt-0.5">
                    {result.bankAccount ? (
                      <span>
                        {result.bankAccount.accountNumber} ·{" "}
                        {result.bankAccount.bankName}
                      </span>
                    ) : (
                      <span className="text-rose-500">
                        Chưa ghi nhận số tài khoản
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Tiêu đề danh sách các công ty đã làm việc */}
          <div className="flex items-center gap-2 px-1">
            <Briefcase className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-bold text-slate-900">
              Chi Tiết Từng Công Ty Đã Làm Việc & Tiền Thưởng (
              {result.companies?.length || 0} lượt)
            </h3>
          </div>

          {/* Danh sách từng công ty */}
          <div className="space-y-4">
            {result.companies && result.companies.length > 0 ? (
              result.companies.map((comp: any, idx: number) => {
                const isWorking = comp.status === "Đang làm việc";
                const hasLeft =
                  comp.status === "Đã nghỉ việc" || !!comp.leaveDate;

                return (
                  <Card
                    key={comp.id || idx}
                    className={`shadow-md rounded-2xl border ${
                      isWorking
                        ? "border-emerald-300 bg-emerald-50/10"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    {/* Header Công ty */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-2.5 rounded-xl ${isWorking ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}
                        >
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-400 uppercase">
                              Lượt {result.companies.length - idx}{" "}
                              {idx === 0 && "· Mới nhất"}
                            </span>
                            <Tag
                              color={
                                isWorking
                                  ? "success"
                                  : hasLeft
                                    ? "error"
                                    : "default"
                              }
                              className="font-semibold"
                            >
                              {comp.status}
                            </Tag>
                          </div>
                          <h4 className="text-lg font-bold text-slate-900 mt-0.5">
                            {comp.factory}
                          </h4>
                        </div>
                      </div>

                      {/* Tổng thưởng tại công ty này */}
                      <div className="text-left sm:text-right bg-amber-50/60 sm:bg-transparent p-2 sm:p-0 rounded-xl">
                        <span className="text-xs text-slate-500">
                          Thưởng nhận tại công ty này:
                        </span>
                        <div className="text-lg font-black text-emerald-700">
                          {(comp.totalBonus || 0).toLocaleString("vi-VN")} đ
                        </div>
                      </div>
                    </div>

                    {/* Lưới thông tin thời gian làm việc */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4 text-xs">
                      <div className="bg-slate-50 p-3 rounded-xl">
                        <span className="text-slate-400 flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-blue-500" />
                          Ngày PV / Bắt đầu làm việc
                        </span>
                        <div className="font-bold text-slate-800 text-sm mt-1">
                          {formatDate(comp.startDate || comp.interviewDate)}
                        </div>
                      </div>

                      <div
                        className={`p-3 rounded-xl ${hasLeft ? "bg-rose-50 border border-rose-100" : "bg-slate-50"}`}
                      >
                        <span
                          className={`${hasLeft ? "text-rose-500 font-semibold" : "text-slate-400"} flex items-center gap-1`}
                        >
                          <Clock className="w-3.5 h-3.5" />
                          Ngày nghỉ việc
                        </span>
                        <div
                          className={`text-sm mt-1 font-bold ${hasLeft ? "text-rose-700" : "text-slate-800"}`}
                        >
                          {comp.leaveDate
                            ? formatDate(comp.leaveDate)
                            : isWorking
                              ? "Đang làm việc"
                              : "—"}
                        </div>
                      </div>

                      <div className="bg-slate-50 p-3 rounded-xl">
                        <span className="text-slate-400 flex items-center gap-1">
                          <Briefcase className="w-3.5 h-3.5 text-slate-500" />
                          Số công / Hợp đồng
                        </span>
                        <div className="font-bold text-slate-800 text-sm mt-1">
                          {comp.confirmedWorkDays != null
                            ? `${comp.confirmedWorkDays} công`
                            : comp.contractType || "Thời vụ"}
                        </div>
                      </div>
                    </div>

                    {/* Lý do nghỉ việc nếu có */}
                    {comp.leaveReason && (
                      <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-rose-800">
                            Lý do nghỉ việc:
                          </strong>{" "}
                          <span className="text-rose-700">
                            {comp.leaveReason}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Chi tiết các khoản thưởng đã nhận tại công ty này */}
                    <div className="mt-4 pt-3 border-t">
                      <h5 className="font-bold text-slate-800 text-xs mb-2 flex items-center gap-1.5">
                        <Coins className="w-4 h-4 text-amber-500" />
                        Chi tiết các lần chi trả thưởng tại {comp.factory}
                      </h5>

                      {/* Đợt chi trả theo mốc công (RewardPayment) */}
                      {comp.payments && comp.payments.length > 0 ? (
                        <div className="space-y-2">
                          {comp.payments.map((p: any, pIdx: number) => (
                            <div
                              key={p.id || pIdx}
                              className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                <div>
                                  <span className="font-bold text-slate-800">
                                    Mốc {p.stageLabel}
                                  </span>
                                  {p.paidOn && (
                                    <span className="text-slate-500 ml-2">
                                      · Ngày chi trả: {formatDate(p.paidOn)}
                                    </span>
                                  )}
                                  {p.reference && (
                                    <div className="text-[11px] font-mono text-slate-400">
                                      Chứng từ: {p.reference}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="font-black text-emerald-700 text-sm text-right">
                                +{Number(p.amount).toLocaleString("vi-VN")} đ
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : comp.bonuses && comp.bonuses.length > 0 ? (
                        /* Đợt chi trả theo DS_THUONG */
                        <div className="space-y-2">
                          {comp.bonuses.map((b: any) => (
                            <div
                              key={b.id}
                              className="p-2.5 rounded-lg border border-slate-200 bg-amber-50/30 flex items-center justify-between text-xs"
                            >
                              <div>
                                <span className="font-bold text-slate-800">
                                  Kỳ {b.month}
                                </span>
                                <div className="text-[11px] text-slate-500">
                                  Lần 1: {(b.bonus1 || 0).toLocaleString()}đ |
                                  Lần 2: {(b.bonus2 || 0).toLocaleString()}đ |
                                  Lần 3: {(b.bonus3 || 0).toLocaleString()}đ
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-black text-emerald-700 text-sm">
                                  {(b.totalBonus || 0).toLocaleString("vi-VN")}{" "}
                                  đ
                                </div>
                                <Tag
                                  color={
                                    b.status === "APPROVED"
                                      ? "success"
                                      : "processing"
                                  }
                                  className="text-[10px]"
                                >
                                  {b.status === "APPROVED"
                                    ? "Đã duyệt chi trả"
                                    : "Đang xử lý"}
                                </Tag>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 italic py-2">
                          Chưa có phát sinh tiền thưởng ghi nhận tại công ty
                          này.
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })
            ) : (
              <p className="text-xs text-slate-400 text-center py-6 bg-slate-50 rounded-xl">
                Chưa có dữ liệu lịch sử làm việc.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
