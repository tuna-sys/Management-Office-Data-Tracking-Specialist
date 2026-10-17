"use client";

import React, { useState } from "react";
import { Card, Empty, Select, Tag, Progress, Tooltip } from "antd";
import {
  Users,
  Briefcase,
  RotateCcw,
  Building2,
  Calendar,
  Award,
  Target,
  TrendingUp,
  MapPin,
  Coins,
  CheckCircle2,
  AlertCircle,
  UserCheck,
  Layers,
  BarChart3,
  PieChart,
  Activity,
} from "lucide-react";

const money = (n: number) => (n || 0).toLocaleString("vi-VN") + " ₫";
const shortMoney = (n: number) => {
  if (!n) return "0 ₫";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} tỷ`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} tr`;
  return n.toLocaleString("vi-VN") + " ₫";
};

export default function OverviewCharts({ data }: { data: any }) {
  const r = data?.recruitment || {};
  const b = data?.rewards || {};
  const summary = r.summary || {};
  const sourcePaid = data?.sourcePaid;
  const sourcePaidTotal = sourcePaid?.total || 0;

  const rewardSummary = {
    ...b.summary,
    paid: (b.summary?.paid || 0) > 0 ? b.summary.paid : sourcePaidTotal,
    earned: (b.summary?.earned || 0) > 0 ? b.summary.earned : sourcePaidTotal,
  };

  const rewardCompanies =
    (b.companies || []).length > 0
      ? b.companies.map((c: any) => ({
          name: c.name,
          rows: c.applications || 0,
          earned: c.earned || 0,
          paid: c.paid || 0,
          outstanding: c.outstanding || 0,
          matched: c.achieved || 0,
          unlinked: 0,
        }))
      : (sourcePaid?.companies || []).map((c: any) => ({
          name: c.name,
          rows: c.rows || 0,
          earned: c.paid || 0,
          paid: c.paid || 0,
          outstanding: 0,
          matched: (c.rows || 0) - (c.unlinked || 0),
          unlinked: c.unlinked || 0,
        }));

  const [demoFactory, setDemoFactory] = useState<string>("ALL");

  const demographics =
    demoFactory === "ALL"
      ? r.demographics || { people: 0, genders: [], provinces: [], ages: [] }
      : r.companyDemographics?.find((d: any) => d.factory === demoFactory) || {
          people: 0,
          genders: [],
          provinces: [],
          ages: [],
        };

  // Funnel & summary metrics
  const totalRecruits = summary.total || 0;
  const totalPeople = summary.people || 0;
  const passed = summary.passed || 0;
  const working = summary.working || 0;
  const returning = summary.returning || 0;
  const returningSameFactory = summary.returningSameFactory || 0;
  const failed = summary.failed || 0;
  const abandoned = summary.abandoned || 0;
  const unknownInterview = summary.unknownInterview || 0;

  const passRate =
    summary.passRate ??
    (totalRecruits ? Math.round((passed / totalRecruits) * 1000) / 10 : 0);
  const workingRate = passed ? Math.round((working / passed) * 1000) / 10 : 0;
  const returnRate =
    summary.returnRate ??
    (totalRecruits ? Math.round((returning / totalRecruits) * 1000) / 10 : 0);
  const abandonRate =
    summary.abandonRate ??
    (totalRecruits ? Math.round((abandoned / totalRecruits) * 1000) / 10 : 0);

  // Sort factories by total recruits descending
  const sortedFactories = [...(r.factories || [])].sort(
    (a, b) => (b.total || 0) - (a.total || 0),
  );
  const maxFactoryTotal = Math.max(
    1,
    ...sortedFactories.map((f) => f.total || 0),
  );

  // Sort statuses by count descending
  const sortedStatuses = [...(r.statuses || [])].sort(
    (a, b) => (b.total || 0) - (a.total || 0),
  );

  // Sort recruiters & teams by total descending
  const sortedRecruiters = [...(r.recruiters || [])]
    .filter((rec) => rec.name && rec.name !== "Chưa gán")
    .sort((a, b) => (b.total || 0) - (a.total || 0));
  const unassignedRecruiter = (r.recruiters || []).find(
    (rec: any) => !rec.name || rec.name === "Chưa gán",
  );
  const maxRecruiterTotal = Math.max(
    1,
    ...sortedRecruiters.map((rec) => rec.total || 0),
  );

  const sortedTeams = [...(r.teams || [])]
    .filter((t) => t.name && t.name !== "Chưa gán")
    .sort((a, b) => (b.total || 0) - (a.total || 0));

  // Sort months chronologically (put UNKNOWN at the end)
  const sortedMonths = [...(r.months || [])].sort((a, b) => {
    if (a.name === "UNKNOWN") return 1;
    if (b.name === "UNKNOWN") return -1;
    return a.name.localeCompare(b.name);
  });
  const validMonths = sortedMonths.filter((m) => m.name !== "UNKNOWN");
  const maxMonthTotal = Math.max(
    1,
    ...(validMonths.length ? validMonths : sortedMonths).map((m) => m.total || 0),
  );

  // Demographics calculations
  const sortedProvinces = [...(demographics.provinces || [])]
    .sort((a, b) => b.count - a.count)
    .filter(
      (p) => p.name !== "Chưa xác định" || demographics.provinces.length === 1,
    );
  const unknownProvince = (demographics.provinces || []).find(
    (p: any) => p.name === "Chưa xác định",
  );
  const maxProvince = Math.max(
    1,
    ...sortedProvinces.map((p) => p.count || 0),
  );

  const maleCount =
    demographics.genders?.find((g: any) => g.name === "Nam")?.count || 0;
  const femaleCount =
    demographics.genders?.find((g: any) => g.name === "Nữ")?.count || 0;
  const unknownGenderCount =
    demographics.genders
      ?.filter((g: any) => g.name !== "Nam" && g.name !== "Nữ")
      .reduce((s: number, g: any) => s + (g.count || 0), 0) || 0;
  const totalGenderKnown = maleCount + femaleCount || 1;
  const totalDemoPeople = demographics.people || totalGenderKnown;
  const malePercent = Math.round((maleCount / totalGenderKnown) * 100);
  const femalePercent = 100 - malePercent;

  // Age order
  const ageOrder = ["Dưới 18", "18–24", "25–34", "35–44", "45 trở lên", "Chưa xác định"];
  const sortedAges = [...(demographics.ages || [])].sort(
    (a, b) => ageOrder.indexOf(a.name) - ageOrder.indexOf(b.name),
  );
  const maxAgeCount = Math.max(1, ...sortedAges.map((a) => a.count || 0));

  // Reward calculations
  const sortedRewardCompanies = [...rewardCompanies].sort(
    (a, b) => (b.paid || 0) - (a.paid || 0),
  );
  const maxRewardCompanyPaid = Math.max(
    1,
    ...sortedRewardCompanies.map((c) => c.paid || 0),
  );
  const totalRewardRows = sortedRewardCompanies.reduce(
    (s, c) => s + (c.rows || 0),
    0,
  );
  const avgRewardPerRow =
    totalRewardRows > 0 ? Math.round((rewardSummary.paid || 0) / totalRewardRows) : 0;

  // Status color helper
  const getStatusColor = (name: string) => {
    const s = String(name || "").toLowerCase();
    if (["lv", "đang làm việc", "chuyển chính thức", "đang lv"].includes(s)) {
      return { bg: "bg-indigo-600", light: "bg-indigo-50 text-indigo-700 border-indigo-200", hex: "#4f46e5", tag: "blue" };
    }
    if (["nh", "nghỉ hẳn", "đã nghỉ việc", "tự ý nghỉ việc"].includes(s)) {
      return { bg: "bg-emerald-500", light: "bg-emerald-50 text-emerald-700 border-emerald-200", hex: "#10b981", tag: "green" };
    }
    if (["hết phí", "hhđ", "hết hợp đồng"].includes(s)) {
      return { bg: "bg-teal-500", light: "bg-teal-50 text-teal-700 border-teal-200", hex: "#14b8a6", tag: "cyan" };
    }
    if (s.startsWith("bỏ") || s.includes("bỏ xx") || s.includes("bỏ đt")) {
      return { bg: "bg-amber-500", light: "bg-amber-50 text-amber-700 border-amber-200", hex: "#f59e0b", tag: "orange" };
    }
    if (s.startsWith("trượt")) {
      return { bg: "bg-rose-500", light: "bg-rose-50 text-rose-700 border-rose-200", hex: "#f43f5e", tag: "red" };
    }
    return { bg: "bg-slate-400", light: "bg-slate-100 text-slate-700 border-slate-200", hex: "#94a3b8", tag: "default" };
  };

  return (
    <div className="space-y-6">
      {/* =====================================================================
          1. PHỄU CHUYỂN ĐỔI & PHÂN BỔ TRẠNG THÁI HỒ SƠ TOÀN HỆ THỐNG
         ===================================================================== */}
      <Card
        className="border-slate-200/90 shadow-sm rounded-2xl overflow-hidden bg-white"
        title={
          <div className="flex flex-wrap items-center justify-between gap-2 py-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-600 text-white shadow-xs">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-base text-slate-900">
                  1. Phễu Chuyển Đổi & Cơ Cấu Trạng Thái Tuyển Dụng
                </span>
                <p className="text-xs font-normal text-slate-500 m-0">
                  Theo dõi tỷ lệ chuyển đổi từ lúc đăng ký phỏng vấn đến khi nhận việc và cơ cấu chi tiết từng mã trạng thái
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tag color="blue" className="rounded-full px-3 py-0.5 text-xs font-semibold m-0">
                Trung bình {(totalRecruits / (totalPeople || 1)).toFixed(2)} lượt / người
              </Tag>
              <Tag color="green" className="rounded-full px-3 py-0.5 text-xs font-semibold m-0">
                Tỷ lệ đỗ PV: {passRate}%
              </Tag>
            </div>
          </div>
        }
      >
        {/* 4 BƯỚC CHUYỂN ĐỔI PHỄU */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Bước 1 */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50/70 to-white border border-blue-200/80 relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-700 flex items-center gap-1.5">
                <Users className="w-4 h-4" /> BƯỚC 1 · TIẾP NHẬN HỒ SƠ
              </span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-blue-600 text-white font-bold">
                100%
              </span>
            </div>
            <div className="text-3xl font-black text-slate-900 tracking-tight">
              {totalRecruits.toLocaleString("vi-VN")}
              <span className="text-xs font-semibold text-slate-500 ml-1.5">
                lượt PV
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
              <span>Số người thực tế:</span>
              <strong className="text-slate-900">
                {totalPeople.toLocaleString("vi-VN")} người
              </strong>
            </div>
            <div className="mt-2 w-full bg-blue-100 h-2 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 rounded-full" style={{ width: "100%" }} />
            </div>
          </div>

          {/* Bước 2 */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50/70 to-white border border-emerald-200/80 relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> BƯỚC 2 · ĐỖ PHỎNG VẤN
              </span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-600 text-white font-bold">
                {passRate}%
              </span>
            </div>
            <div className="text-3xl font-black text-emerald-700 tracking-tight">
              {passed.toLocaleString("vi-VN")}
              <span className="text-xs font-semibold text-slate-500 ml-1.5">
                lượt đỗ
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
              <span>Bỏ PV / Trượt PV:</span>
              <strong className="text-amber-700">
                {abandoned.toLocaleString("vi-VN")} bỏ · {failed} trượt
              </strong>
            </div>
            <div className="mt-2 w-full bg-emerald-100 h-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-600 rounded-full"
                style={{ width: `${Math.min(100, passRate)}%` }}
              />
            </div>
          </div>

          {/* Bước 3 */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-50/70 to-white border border-indigo-200/80 relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
                <Briefcase className="w-4 h-4" /> BƯỚC 3 · ĐANG LÀM VIỆC
              </span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-600 text-white font-bold">
                {workingRate}% đỗ
              </span>
            </div>
            <div className="text-3xl font-black text-indigo-700 tracking-tight">
              {working.toLocaleString("vi-VN")}
              <span className="text-xs font-semibold text-slate-500 ml-1.5">
                người đang LV
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
              <span>Đã hoàn thành / nghỉ:</span>
              <strong className="text-slate-800">
                {Math.max(0, passed - working).toLocaleString("vi-VN")} lượt
              </strong>
            </div>
            <div className="mt-2 w-full bg-indigo-100 h-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full"
                style={{
                  width: `${Math.max(4, Math.min(100, workingRate))}%`,
                }}
              />
            </div>
          </div>

          {/* Bước 4 */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-cyan-50/70 to-white border border-cyan-200/80 relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-700 flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4" /> BƯỚC 4 · TÁI TUYỂN DỤNG
              </span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-cyan-600 text-white font-bold">
                {returnRate}%
              </span>
            </div>
            <div className="text-3xl font-black text-cyan-700 tracking-tight">
              {returning.toLocaleString("vi-VN")}
              <span className="text-xs font-semibold text-slate-500 ml-1.5">
                lượt quay lại
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
              <span>Quay lại đúng nhà máy cũ:</span>
              <strong className="text-cyan-800">
                {returningSameFactory.toLocaleString("vi-VN")} lượt
              </strong>
            </div>
            <div className="mt-2 w-full bg-cyan-100 h-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-600 rounded-full"
                style={{ width: `${Math.max(4, Math.min(100, returnRate * 3))}%` }}
              />
            </div>
          </div>
        </div>

        {/* THANH BIỂU ĐỒ PHÂN BỔ TRẠNG THÁI HỒ SƠ (STACKED STATUS BAR + CHI TIẾT) */}
        {sortedStatuses.length > 0 && (
          <div className="mt-6 pt-5 border-t border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-blue-600" />
                Biểu Đồ Tỷ Trọng Chi Tiết Từng Trạng Thái Hồ Sơ ({totalRecruits.toLocaleString("vi-VN")} lượt)
              </span>
              <span className="text-xs text-slate-500">
                Rê chuột vào từng phân đoạn màu hoặc xem bảng chi tiết bên dưới
              </span>
            </div>

            {/* Multi-segment stacked bar */}
            <div className="h-7 w-full rounded-xl overflow-hidden flex bg-slate-100 p-0.5 gap-0.5 shadow-inner">
              {sortedStatuses.map((st) => {
                const count = st.total || 0;
                const pctVal = totalRecruits
                  ? Math.round((count / totalRecruits) * 1000) / 10
                  : 0;
                if (pctVal <= 0) return null;
                const style = getStatusColor(st.name);
                return (
                  <Tooltip
                    key={st.name}
                    title={`${st.name}: ${count.toLocaleString("vi-VN")} lượt (${pctVal}%)`}
                  >
                    <div
                      style={{ width: `${Math.max(1.2, pctVal)}%` }}
                      className={`${style.bg} h-full first:rounded-l-lg last:rounded-r-lg flex items-center justify-center text-[11px] font-bold text-white overflow-hidden whitespace-nowrap transition-all hover:opacity-90 cursor-pointer`}
                    >
                      {pctVal >= 6 ? `${st.name} (${pctVal}%)` : ""}
                    </div>
                  </Tooltip>
                );
              })}
            </div>

            {/* Lưới thẻ chi tiết từng trạng thái */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 mt-3">
              {sortedStatuses.map((st) => {
                const count = st.total || 0;
                const pctVal = totalRecruits
                  ? ((count / totalRecruits) * 100).toFixed(1)
                  : "0.0";
                const style = getStatusColor(st.name);
                return (
                  <div
                    key={st.name}
                    className={`p-2.5 rounded-xl border ${style.light} flex flex-col justify-between`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold truncate" title={st.name}>
                        {st.name}
                      </span>
                      <span className="text-[11px] font-semibold opacity-80 shrink-0">
                        {pctVal}%
                      </span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="text-lg font-black">
                        {count.toLocaleString("vi-VN")}
                      </span>
                      <span className="text-[10px] opacity-75">
                        {st.people || count} người
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* =====================================================================
          2. SO SÁNH QUY MÔ & HIỆU SUẤT CÁC NHÀ MÁY (FACTORY STACKED ANALYTICS)
         ===================================================================== */}
      <Card
        className="border-slate-200/90 shadow-sm rounded-2xl bg-white"
        title={
          <div className="flex flex-wrap items-center justify-between gap-2 py-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-xs">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-base text-slate-900">
                  2. Biểu Đồ So Sánh Quy Mô & Chất Lượng Tuyển Dụng Theo Nhà Máy ({sortedFactories.length} nhà máy)
                </span>
                <p className="text-xs font-normal text-slate-500 m-0">
                  So sánh tổng lượt tuyển, tỷ trọng đóng góp, tỷ lệ đỗ phỏng vấn, số đang làm việc và chi tiết trạng thái từng nhà máy
                </p>
              </div>
            </div>
            {/* Chú thích màu thanh biểu đồ */}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-indigo-600 inline-block" />
                Đang làm việc
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-emerald-500 inline-block" />
                Đỗ PV (Đã hoàn thành/nghỉ)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-amber-400 inline-block" />
                Bỏ phỏng vấn
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-rose-500 inline-block" />
                Trượt PV
              </span>
            </div>
          </div>
        }
      >
        {!sortedFactories.length ? (
          <Empty description="Chưa có dữ liệu nhà máy" />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {sortedFactories.map((factory, index) => {
              const total = factory.total || 0;
              const fPassed = factory.passed || 0;
              const fWorking = factory.working || 0;
              const fPassedDone = Math.max(0, fPassed - fWorking);
              const fAbandoned = factory.abandoned || 0;
              const fFailed = factory.failed || 0;
              const fPassRate =
                factory.passRate ?? Math.round((fPassed / (total || 1)) * 100);
              const shareOfSystem = totalRecruits
                ? ((total / totalRecruits) * 100).toFixed(1)
                : "0.0";
              const scaleWidth = Math.max(
                12,
                Math.round((total / maxFactoryTotal) * 100),
              );

              // Phổ phần trăm bên trong thanh của nhà máy
              const wPct = total ? (fWorking / total) * 100 : 0;
              const pPct = total ? (fPassedDone / total) * 100 : 0;
              const aPct = total ? (fAbandoned / total) * 100 : 0;
              const fPct = total ? (fFailed / total) * 100 : 0;

              const statusEntries = Object.entries(
                factory.statusCounts || {},
              ).sort((a: any, b: any) => b[1] - a[1]);

              return (
                <div
                  key={factory.name}
                  className="p-4 rounded-xl bg-slate-50/70 hover:bg-blue-50/30 border border-slate-200/80 transition-all flex flex-col justify-between"
                >
                  <div>
                    {/* Hàng tiêu đề nhà máy */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-6 h-6 flex items-center justify-center rounded-lg text-xs font-black ${
                            index === 0
                              ? "bg-amber-400 text-slate-950 shadow-xs"
                              : index === 1
                                ? "bg-slate-300 text-slate-900"
                                : index === 2
                                  ? "bg-amber-200 text-amber-950"
                                  : "bg-slate-200/80 text-slate-600"
                          }`}
                        >
                          #{index + 1}
                        </span>
                        <div>
                          <span className="font-black text-slate-900 text-base">
                            {factory.name}
                          </span>
                          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-700 font-semibold">
                            Chiếm {shareOfSystem}% toàn hệ thống
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-lg font-black text-slate-900">
                          {total.toLocaleString("vi-VN")}
                        </span>
                        <span className="text-xs text-slate-500 ml-1">
                          lượt ({ (factory.people || total).toLocaleString("vi-VN") } người)
                        </span>
                      </div>
                    </div>

                    {/* Thanh Stacked Bar đa sắc thể hiện quy mô và cấu trúc */}
                    <div className="w-full bg-slate-200/70 h-4 rounded-lg overflow-hidden p-0.5 mb-3">
                      <div
                        style={{ width: `${scaleWidth}%` }}
                        className="h-full rounded-md overflow-hidden flex shadow-2xs"
                      >
                        {wPct > 0 && (
                          <Tooltip title={`Đang làm việc: ${fWorking} người`}>
                            <div
                              style={{ width: `${wPct}%` }}
                              className="h-full bg-indigo-600"
                            />
                          </Tooltip>
                        )}
                        {pPct > 0 && (
                          <Tooltip
                            title={`Đỗ PV (Đã hoàn thành/nghỉ): ${fPassedDone} lượt`}
                          >
                            <div
                              style={{ width: `${pPct}%` }}
                              className="h-full bg-emerald-500"
                            />
                          </Tooltip>
                        )}
                        {aPct > 0 && (
                          <Tooltip title={`Bỏ PV: ${fAbandoned} lượt`}>
                            <div
                              style={{ width: `${aPct}%` }}
                              className="h-full bg-amber-400"
                            />
                          </Tooltip>
                        )}
                        {fPct > 0 && (
                          <Tooltip title={`Trượt PV: ${fFailed} lượt`}>
                            <div
                              style={{ width: `${fPct}%` }}
                              className="h-full bg-rose-500"
                            />
                          </Tooltip>
                        )}
                      </div>
                    </div>

                    {/* 4 chỉ số cốt lõi của Nhà máy */}
                    <div className="grid grid-cols-4 gap-2 text-center bg-white p-2.5 rounded-lg border border-slate-200/60 mb-2.5">
                      <div>
                        <span className="text-[11px] text-slate-500 block">
                          Đỗ PV
                        </span>
                        <strong className="text-emerald-600 text-sm">
                          {fPassed.toLocaleString("vi-VN")}
                        </strong>
                        <span className="text-[10px] text-emerald-700 font-semibold block">
                          ({fPassRate}%)
                        </span>
                      </div>
                      <div className="border-l border-slate-100">
                        <span className="text-[11px] text-slate-500 block">
                          Đang LV
                        </span>
                        <strong className="text-indigo-600 text-sm">
                          {fWorking.toLocaleString("vi-VN")}
                        </strong>
                        <span className="text-[10px] text-slate-400 block">
                          người
                        </span>
                      </div>
                      <div className="border-l border-slate-100">
                        <span className="text-[11px] text-slate-500 block">
                          Bỏ / Trượt
                        </span>
                        <strong className="text-amber-600 text-sm">
                          {(fAbandoned + fFailed).toLocaleString("vi-VN")}
                        </strong>
                        <span className="text-[10px] text-slate-400 block">
                          {fAbandoned} bỏ · {fFailed} trượt
                        </span>
                      </div>
                      <div className="border-l border-slate-100">
                        <span className="text-[11px] text-slate-500 block">
                          Tái tuyển
                        </span>
                        <strong className="text-cyan-600 text-sm">
                          {(factory.returning || 0).toLocaleString("vi-VN")}
                        </strong>
                        <span className="text-[10px] text-slate-400 block">
                          quay lại
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Chi tiết từng mã trạng thái của nhà máy */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {statusEntries.map(([stName, stCount]: any) => {
                      const stStyle = getStatusColor(stName);
                      return (
                        <Tag
                          key={stName}
                          color={stStyle.tag}
                          className="text-[11px] m-0 rounded-md"
                        >
                          {stName}: <strong>{stCount.toLocaleString("vi-VN")}</strong>
                        </Tag>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* =====================================================================
          3. BIỂU ĐỒ CỘT XU HƯỚNG TUYỂN DỤNG THEO THÁNG PHỎNG VẤN
         ===================================================================== */}
      <Card
        className="border-slate-200/90 shadow-sm rounded-2xl bg-white"
        title={
          <div className="flex flex-wrap items-center justify-between gap-2 py-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-600 text-white shadow-xs">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-base text-slate-900">
                  3. Biểu Đồ Xu Hướng & Nhịp Độ Tuyển Dụng Qua Các Tháng ({sortedMonths.length} kỳ)
                </span>
                <p className="text-xs font-normal text-slate-500 m-0">
                  Biểu đồ cột trực quan so sánh Tổng lượt phỏng vấn, Lượt đỗ PV và Bỏ/Trượt theo từng tháng
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-blue-500 inline-block" />
                Tổng lượt tuyển
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-emerald-500 inline-block" />
                Đỗ phỏng vấn
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-amber-400 inline-block" />
                Bỏ / Trượt PV
              </span>
            </div>
          </div>
        }
      >
        {!sortedMonths.length ? (
          <Empty description="Chưa có dữ liệu tháng phỏng vấn" />
        ) : (
          <div className="space-y-6">
            {/* BIỂU ĐỒ CỘT ĐỨNG TRỰC QUAN (VERTICAL BAR CHART) */}
            <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/70 overflow-x-auto">
              <div className="min-w-[640px] flex items-end justify-around gap-3 h-56 pt-8 pb-2 px-2 border-b border-slate-200">
                {sortedMonths.map((m) => {
                  const total = m.total || 0;
                  const mPassed = m.passed || 0;
                  const mDrop = (m.abandoned || 0) + (m.failed || 0);
                  const mRate =
                    m.passRate ?? Math.round((mPassed / (total || 1)) * 100);

                  const totalH = Math.max(8, Math.round((total / maxMonthTotal) * 165));
                  const passH = Math.max(6, Math.round((mPassed / maxMonthTotal) * 165));
                  const dropH = mDrop > 0 ? Math.max(4, Math.round((mDrop / maxMonthTotal) * 165)) : 0;

                  const monthLabel =
                    m.name === "UNKNOWN"
                      ? "Chưa rõ tháng"
                      : m.name.replace(/^(\d{4})-(\d{2})$/, "T$2/$1");

                  return (
                    <div
                      key={m.name}
                      className="flex flex-col items-center flex-1 group"
                    >
                      {/* Badge tỷ lệ đỗ trên đỉnh cột */}
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md mb-1">
                        {mRate}%
                      </span>
                      <span className="text-xs font-black text-slate-800 mb-1">
                        {total.toLocaleString("vi-VN")}
                      </span>

                      {/* Cụm 3 cột: Tổng - Đỗ - Bỏ/Trượt */}
                      <div className="flex items-end gap-1 h-[170px]">
                        <Tooltip
                          title={`${monthLabel} · Tổng lượt tuyển: ${total.toLocaleString("vi-VN")} (${m.people || total} người)`}
                        >
                          <div
                            style={{ height: `${totalH}px` }}
                            className="w-4 sm:w-5 bg-blue-500 hover:bg-blue-600 rounded-t-md transition-all cursor-pointer"
                          />
                        </Tooltip>
                        <Tooltip
                          title={`${monthLabel} · Đỗ PV: ${mPassed.toLocaleString("vi-VN")} (${mRate}%) · Đang làm: ${m.working || 0}`}
                        >
                          <div
                            style={{ height: `${passH}px` }}
                            className="w-4 sm:w-5 bg-emerald-500 hover:bg-emerald-600 rounded-t-md transition-all cursor-pointer"
                          />
                        </Tooltip>
                        {dropH > 0 && (
                          <Tooltip
                            title={`${monthLabel} · Bỏ/Trượt: ${mDrop.toLocaleString("vi-VN")} (${m.abandoned || 0} bỏ, ${m.failed || 0} trượt)`}
                          >
                            <div
                              style={{ height: `${dropH}px` }}
                              className="w-3 sm:w-4 bg-amber-400 hover:bg-amber-500 rounded-t-md transition-all cursor-pointer"
                            />
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Nhãn trục hoành (Tháng) */}
              <div className="min-w-[640px] flex items-center justify-around gap-3 pt-2 px-2">
                {sortedMonths.map((m) => {
                  const monthLabel =
                    m.name === "UNKNOWN"
                      ? "Chưa rõ"
                      : m.name.replace(/^(\d{4})-(\d{2})$/, "T$2/$1");
                  return (
                    <div
                      key={m.name}
                      className="flex-1 text-center text-xs font-bold text-slate-700"
                    >
                      {monthLabel}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* LƯỚI THẺ CHI TIẾT TỪNG THÁNG */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {sortedMonths.map((m) => {
                const total = m.total || 0;
                const mPassed = m.passed || 0;
                const mWorking = m.working || 0;
                const mAbandoned = m.abandoned || 0;
                const mReturning = m.returning || 0;
                const mRate =
                  m.passRate ?? Math.round((mPassed / (total || 1)) * 100);
                const monthLabel =
                  m.name === "UNKNOWN"
                    ? "Chưa xác định ngày PV"
                    : `Tháng ${m.name.replace(/^(\d{4})-(\d{2})$/, "$2/$1")}`;

                return (
                  <div
                    key={m.name}
                    className="p-3.5 rounded-xl bg-white border border-slate-200/80 hover:border-emerald-300 shadow-2xs transition-all"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-emerald-600" />
                        {monthLabel}
                      </span>
                      <Tag
                        color={mRate >= 80 ? "green" : "orange"}
                        className="font-bold m-0"
                      >
                        Đỗ {mRate}%
                      </Tag>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5 py-2 text-center bg-slate-50 rounded-lg border border-slate-100 my-1.5 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500 block">
                          Lượt PV
                        </span>
                        <strong className="text-slate-900">
                          {total.toLocaleString("vi-VN")}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">
                          Đỗ PV
                        </span>
                        <strong className="text-emerald-600">
                          {mPassed.toLocaleString("vi-VN")}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">
                          Đang LV
                        </span>
                        <strong className="text-indigo-600">
                          {mWorking.toLocaleString("vi-VN")}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">
                          Bỏ PV
                        </span>
                        <strong className="text-amber-600">
                          {mAbandoned.toLocaleString("vi-VN")}
                        </strong>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                      <span>Số người: <strong>{m.people || total}</strong></span>
                      <span>Quay lại: <strong>{mReturning}</strong> lượt</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* =====================================================================
          4. HIỆU SUẤT CHUYÊN VIÊN TUYỂN DỤNG, ĐỘI NHÓM & ĐƠN HÀNG
         ===================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 4.1 Bảng xếp hạng Top Chuyên viên Tuyển dụng */}
        <Card
          className="border-slate-200/90 shadow-sm rounded-2xl bg-white lg:col-span-2"
          title={
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-cyan-600 text-white">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-bold text-base text-slate-900">
                    4. Hiệu Suất Chuyên Viên Tuyển Dụng & Đội Nhóm
                  </span>
                  <p className="text-xs font-normal text-slate-500 m-0">
                    Thống kê năng suất tuyển dụng, tỷ lệ đỗ phỏng vấn và giữ chân lao động
                  </p>
                </div>
              </div>
              <Tag color="cyan" className="font-semibold m-0">
                {sortedRecruiters.length} chuyên viên · {sortedTeams.length} đội nhóm
              </Tag>
            </div>
          }
        >
          {sortedRecruiters.length === 0 && sortedTeams.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70 text-xs text-slate-600 space-y-2">
              <div className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                Hồ sơ hiện tại đang tập trung ở nhóm &ldquo;Chưa gán chuyên viên / đội nhóm&rdquo; ({unassignedRecruiter?.total?.toLocaleString("vi-VN") || totalRecruits.toLocaleString("vi-VN")} lượt)
              </div>
              <p className="m-0">
                • Đỗ phỏng vấn: <strong className="text-emerald-700">{(unassignedRecruiter?.passed || passed).toLocaleString("vi-VN")} lượt ({unassignedRecruiter?.passRate ?? passRate}%)</strong> · Đang làm việc: <strong className="text-indigo-700">{unassignedRecruiter?.working || working} người</strong> · Bỏ PV: <strong className="text-amber-700">{(unassignedRecruiter?.abandoned || abandoned).toLocaleString("vi-VN")} lượt</strong>.
                <br />• Khi cập nhật cột <b>Tuyển dụng</b> / <b>Đội nhóm</b> trong Hồ sơ lao động hoặc file Excel, bảng xếp hạng Top chuyên viên sẽ tự động phân tách tại đây.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {sortedRecruiters.slice(0, 12).map((rec, idx) => {
                const rTotal = rec.total || 0;
                const rPass = rec.passed || 0;
                const rWork = rec.working || 0;
                const rRate = rec.passRate ?? Math.round((rPass / (rTotal || 1)) * 100);
                const barW = Math.round((rTotal / maxRecruiterTotal) * 100);

                return (
                  <div
                    key={rec.name}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-cyan-100 text-cyan-800 text-xs font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <strong className="text-slate-900 text-sm">{rec.name}</strong>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <Tag color="green" className="m-0">
                          Đỗ: {rPass} ({rRate}%)
                        </Tag>
                        <Tag color="blue" className="m-0">
                          Đang làm: {rWork}
                        </Tag>
                        <strong className="text-slate-900 text-sm">
                          {rTotal} lượt
                        </strong>
                      </div>
                    </div>
                    <Progress
                      percent={barW}
                      showInfo={false}
                      size="small"
                      strokeColor="#0891b2"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* 4.2 Tiến độ Đơn hàng & Chỉ tiêu */}
        <Card
          className="border-slate-200/90 shadow-sm rounded-2xl bg-white"
          title={
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-purple-600 text-white">
                  <Target className="w-4 h-4" />
                </div>
                <span className="font-bold text-sm text-slate-900">
                  Tiến Độ Đơn Hàng ({r.orders?.length || 0})
                </span>
              </div>
            </div>
          }
        >
          {!(r.orders || []).length ? (
            <Empty description="Chưa có dữ liệu đơn hàng" />
          ) : (
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {(r.orders || []).map((order: any) => {
                const target = order.target;
                const oPassed = order.passed || 0;
                const oTotal = order.total || 0;
                const oWorking = order.working || 0;
                const oAbandoned = order.abandoned || 0;
                const hasTarget = target != null && target > 0;
                const targetProgress = hasTarget
                  ? Math.min(100, Math.round((oPassed / target) * 100))
                  : null;

                return (
                  <div
                    key={order.id || order.name}
                    className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">
                          {order.name}
                        </div>
                        <span className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          {order.factory || "Tất cả nhà máy"}
                        </span>
                      </div>
                      <Tag color="blue" className="font-bold m-0">
                        {oTotal.toLocaleString("vi-VN")} lượt
                      </Tag>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center bg-white p-2 rounded-lg border border-slate-200/60 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500 block">
                          Đỗ PV
                        </span>
                        <strong className="text-emerald-600">
                          {oPassed.toLocaleString("vi-VN")} ({order.passRate ?? 0}%)
                        </strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">
                          Đang LV
                        </span>
                        <strong className="text-indigo-600">
                          {oWorking.toLocaleString("vi-VN")}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">
                          Bỏ PV
                        </span>
                        <strong className="text-amber-600">
                          {oAbandoned.toLocaleString("vi-VN")}
                        </strong>
                      </div>
                    </div>

                    {hasTarget && (
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-500">Chỉ tiêu: {target}</span>
                          <strong className="text-blue-700">Đạt {targetProgress}%</strong>
                        </div>
                        <Progress
                          percent={targetProgress || 0}
                          size="small"
                          strokeColor={
                            targetProgress && targetProgress >= 100
                              ? "#16a34a"
                              : "#2563eb"
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* =====================================================================
          5. CHÂN DUNG ỨNG VIÊN (DEMOGRAPHICS: DONUT GIỚI TÍNH, ĐỘ TUỔI, TỈNH THÀNH)
         ===================================================================== */}
      <Card
        className="border-slate-200/90 shadow-sm rounded-2xl bg-white"
        title={
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-pink-600 text-white shadow-xs">
                <PieChart className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-base text-slate-900">
                  5. Phân Tích Nhân Khẩu Học & Chân Dung Người Lao Động
                </span>
                <p className="text-xs font-normal text-slate-500 m-0">
                  Cơ cấu Giới tính (Biểu đồ Donut), Nhóm độ tuổi tại thời điểm phỏng vấn và Top Tỉnh/Thành phố
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">
                Lọc theo nhà máy:
              </span>
              <Select
                size="small"
                className="w-52"
                value={demoFactory}
                onChange={setDemoFactory}
                options={[
                  { value: "ALL", label: "Toàn bộ hệ thống (Tất cả)" },
                  ...(r.companyDemographics || []).map((d: any) => ({
                    value: d.factory,
                    label: `${d.factory} (${d.people || 0} người)`,
                  })),
                ]}
              />
            </div>
          </div>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 5.1 Biểu đồ Donut Giới tính */}
          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/80 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-slate-800 text-sm">
                Cơ Cấu Giới Tính
              </span>
              <Tag color="blue" className="m-0 text-xs">
                {totalDemoPeople.toLocaleString("vi-VN")} người
              </Tag>
            </div>

            {/* Donut SVG */}
            <div className="flex items-center justify-center gap-6 my-2">
              <div className="relative w-36 h-36 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 36 36" className="w-36 h-36 -rotate-90">
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9155"
                    fill="transparent"
                    stroke="#ec4899"
                    strokeWidth="3.8"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9155"
                    fill="transparent"
                    stroke="#2563eb"
                    strokeWidth="3.8"
                    strokeDasharray={`${malePercent} ${100 - malePercent}`}
                    strokeDashoffset="0"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-lg font-black text-slate-900">
                    {malePercent}% / {femalePercent}%
                  </span>
                  <span className="text-[10px] text-slate-500">Nam / Nữ</span>
                </div>
              </div>

              <div className="space-y-2.5 flex-1">
                <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200/80">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-blue-700">● Nam giới</span>
                    <span className="font-bold text-blue-900">{malePercent}%</span>
                  </div>
                  <div className="text-base font-black text-blue-950 mt-0.5">
                    {maleCount.toLocaleString("vi-VN")}{" "}
                    <span className="text-xs font-normal text-blue-600">người</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-pink-50 border border-pink-200/80">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-pink-700">● Nữ giới</span>
                    <span className="font-bold text-pink-900">{femalePercent}%</span>
                  </div>
                  <div className="text-base font-black text-pink-950 mt-0.5">
                    {femaleCount.toLocaleString("vi-VN")}{" "}
                    <span className="text-xs font-normal text-pink-600">người</span>
                  </div>
                </div>

                {unknownGenderCount > 0 && (
                  <div className="text-[11px] text-slate-500 px-1">
                    Chưa ghi nhận giới tính:{" "}
                    <strong>{unknownGenderCount.toLocaleString("vi-VN")}</strong> người
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 5.2 Biểu đồ Phân bổ Độ tuổi */}
          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/80 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-slate-800 text-sm">
                Phân Bổ Nhóm Độ Tuổi (Tại Ngày PV)
              </span>
              <Tag color="purple" className="m-0 text-xs">
                Theo năm sinh
              </Tag>
            </div>

            {!sortedAges.length ? (
              <Empty description="Chưa có dữ liệu độ tuổi" />
            ) : (
              <div className="space-y-3 my-auto">
                {sortedAges.map((age: any) => {
                  const count = age.count || 0;
                  const agePct = totalDemoPeople
                    ? ((count / totalDemoPeople) * 100).toFixed(1)
                    : "0.0";
                  const barScale = Math.round((count / maxAgeCount) * 100);
                  const barColor =
                    age.name === "18–24"
                      ? "bg-emerald-500"
                      : age.name === "25–34"
                        ? "bg-blue-600"
                        : age.name === "35–44"
                          ? "bg-purple-600"
                          : age.name === "Dưới 18"
                            ? "bg-rose-500"
                            : age.name === "45 trở lên"
                              ? "bg-amber-500"
                              : "bg-slate-400";

                  return (
                    <div key={age.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800">
                          Độ tuổi: {age.name}
                        </span>
                        <span className="text-slate-600">
                          <strong className="text-slate-900">
                            {count.toLocaleString("vi-VN")}
                          </strong>{" "}
                          người ({agePct}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-200/80 h-3 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${Math.max(3, barScale)}%` }}
                          className={`h-full ${barColor} rounded-full transition-all`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 5.3 Top Tỉnh thành / Quê quán */}
          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/80 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-slate-800 text-sm">
                Top Tỉnh Thành / Quê Quán
              </span>
              <Tag color="indigo" className="m-0 text-xs">
                {sortedProvinces.length} tỉnh/thành
              </Tag>
            </div>

            {!sortedProvinces.length ? (
              <Empty description="Chưa có thông tin quê quán" />
            ) : (
              <div className="space-y-2.5 max-h-[250px] overflow-y-auto pr-1">
                {sortedProvinces.slice(0, 10).map((p: any, i: number) => {
                  const count = p.count || 0;
                  const percent = Math.round((count / maxProvince) * 100);
                  const share = totalDemoPeople
                    ? ((count / totalDemoPeople) * 100).toFixed(1)
                    : "0.0";

                  return (
                    <div key={p.name} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center">
                            {i + 1}
                          </span>
                          {p.name}
                        </span>
                        <span className="text-slate-600">
                          <strong className="text-slate-900">
                            {count.toLocaleString("vi-VN")}
                          </strong>{" "}
                          ({share}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-200/70 h-2 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${percent}%` }}
                          className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 rounded-full"
                        />
                      </div>
                    </div>
                  );
                })}
                {unknownProvince && unknownProvince.count > 0 && (
                  <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                    Chưa phân tách tỉnh/thành:{" "}
                    <strong>{unknownProvince.count.toLocaleString("vi-VN")}</strong> người
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* =====================================================================
          6. BIỂU ĐỒ DÒNG TIỀN & TIẾN ĐỘ CHI THƯỞNG THEO CÔNG TY
         ===================================================================== */}
      <Card
        className="border-slate-200/90 shadow-sm rounded-2xl bg-white"
        title={
          <div className="flex flex-wrap items-center justify-between gap-2 py-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-500 text-white shadow-xs">
                <Coins className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-base text-slate-900">
                  6. Biểu Đồ Phân Bổ Dòng Tiền & Tiến Độ Giải Ngân Thưởng Theo Công Ty
                </span>
                <p className="text-xs font-normal text-slate-500 m-0">
                  Đối chiếu tổng ngân sách thưởng đạt mốc, thực tế đã thanh toán, số lượt nhận thưởng và mức thưởng bình quân
                </p>
              </div>
            </div>
            <Tag color="green" className="text-xs font-bold px-3 py-1 rounded-full m-0">
              Tổng đã chi trả: {money(rewardSummary.paid)}
            </Tag>
          </div>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 6.1 Khối Tổng quan tỷ lệ giải ngân */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50/60 via-white to-amber-50/40 border border-emerald-200/80 flex flex-col justify-between">
            <div className="text-center py-2">
              <Progress
                type="dashboard"
                percent={
                  rewardSummary.earned
                    ? Math.min(
                        100,
                        Math.round(
                          ((rewardSummary.paid || 0) / rewardSummary.earned) * 100,
                        ),
                      )
                    : 100
                }
                strokeColor={{
                  "0%": "#10b981",
                  "100%": "#059669",
                }}
                size={165}
                format={(percent) => (
                  <div>
                    <div className="text-2xl font-black text-emerald-700">
                      {percent}%
                    </div>
                    <span className="text-xs text-slate-500 font-semibold">
                      Đã giải ngân
                    </span>
                  </div>
                )}
              />
            </div>

            <div className="space-y-2.5 pt-3 border-t border-slate-200/70 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-200/60">
                <span className="text-slate-600">Tổng tiền đạt mốc:</span>
                <strong className="text-purple-700 text-sm">
                  {money(rewardSummary.earned)}
                </strong>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-200/60">
                <span className="text-slate-600">Thực tế đã chi trả:</span>
                <strong className="text-emerald-700 text-sm">
                  {money(rewardSummary.paid)}
                </strong>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-200/60">
                <span className="text-slate-600">Tổng lượt nhận thưởng:</span>
                <strong className="text-slate-900 text-sm">
                  {totalRewardRows.toLocaleString("vi-VN")} lượt
                </strong>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-200/60">
                <span className="text-slate-600">Trung bình / lượt nhận:</span>
                <strong className="text-blue-700 text-sm">
                  {money(avgRewardPerRow)}
                </strong>
              </div>
            </div>
          </div>

          {/* 6.2 Biểu đồ so sánh ngân sách thưởng theo từng công ty */}
          <div className="lg:col-span-2 space-y-3">
            {!sortedRewardCompanies.length ? (
              <Empty description="Chưa có dữ liệu thưởng theo công ty" />
            ) : (
              sortedRewardCompanies.map((comp: any, idx: number) => {
                const earned = comp.earned || 0;
                const paid = comp.paid || 0;
                const rowsCount = comp.rows || 0;
                const avgPerWorker = rowsCount ? Math.round(paid / rowsCount) : 0;
                const shareOfTotalPaid = rewardSummary.paid
                  ? ((paid / rewardSummary.paid) * 100).toFixed(1)
                  : "0.0";
                const barWidth = Math.max(
                  6,
                  Math.round((paid / maxRewardCompanyPaid) * 100),
                );

                return (
                  <div
                    key={comp.name}
                    className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 hover:border-emerald-300 transition-all"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-black flex items-center justify-center">
                          #{idx + 1}
                        </span>
                        <span className="font-black text-slate-900 text-base">
                          {comp.name}
                        </span>
                        <Tag color="cyan" className="m-0 text-xs font-semibold">
                          Chiếm {shareOfTotalPaid}% tổng quỹ
                        </Tag>
                      </div>

                      <div className="text-right">
                        <span className="text-base font-black text-emerald-700">
                          {money(paid)}
                        </span>
                        <span className="text-xs text-slate-500 ml-1.5">
                          ({shortMoney(paid)})
                        </span>
                      </div>
                    </div>

                    {/* Thanh tỷ trọng tiền thưởng */}
                    <div className="w-full bg-slate-200/80 h-3 rounded-full overflow-hidden mb-2.5">
                      <div
                        style={{ width: `${barWidth}%` }}
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs bg-white p-2 rounded-lg border border-slate-200/60">
                      <div>
                        <span className="text-slate-500">Số lượt nhận thưởng: </span>
                        <strong className="text-slate-900">
                          {rowsCount.toLocaleString("vi-VN")} lượt
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Bình quân / lượt: </span>
                        <strong className="text-blue-700">
                          {money(avgPerWorker)}
                        </strong>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-500">Khớp DS_TONG: </span>
                        <strong className="text-emerald-700">
                          {(comp.matched || 0).toLocaleString("vi-VN")} lượt
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
