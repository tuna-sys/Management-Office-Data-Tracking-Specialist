"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  Select,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Badge,
  message,
  Popconfirm,
  Modal,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { formatDate } from "@/lib/date-format";
import {
  AlertCircle,
  AlertTriangle,
  FileSpreadsheet,
  RefreshCw,
  Search,
  ShieldAlert,
  Coins,
  Users,
  Info,
  Building2,
  Calendar,
  Trash2,
  Eye,
  Check,
  ArrowRightLeft,
} from "lucide-react";

interface Issue {
  row: number;
  message: string;
  kind: string;
}

interface ReviewItem {
  id: string;
  sourceId: string;
  file: string;
  sheet: string;
  importType: string;
  row: number;
  values: Record<string, any>;
  issues: Issue[];
  existingRecord?: Record<string, any> | null;
}

interface IssueExplanation {
  category: string;
  color: string;
  badge: string;
  title: string;
  detail: string;
  solution: string;
}

function explainIssue(
  rawMessage: string,
  values: Record<string, any> = {},
): IssueExplanation {
  const msg = rawMessage.replace(/^Dòng \d+:\s*/, "").trim();

  if (
    msg.includes("CHƯA BÁO NGHỈ") ||
    msg.includes("CCCD có đợt Đang làm việc") ||
    msg.includes("trùng CCCD đang hoạt động")
  ) {
    return {
      category: "Đang làm xưởng khác (Chưa báo nghỉ)",
      color: "red",
      badge: "🚨 Chưa báo nghỉ",
      title: "Đang làm việc tại xưởng khác (Chưa báo nghỉ)",
      detail: msg,
      solution:
        "Liên hệ ngay xưởng cũ để kiểm tra thủ tục nghỉ việc trước khi tiếp nhận tại xưởng mới.",
    };
  }

  if (
    msg.includes("SĐT ĐANG HOẠT ĐỘNG") ||
    msg.includes("SĐT trùng hồ sơ đang hoạt động")
  ) {
    return {
      category: "SĐT đang hoạt động xưởng khác",
      color: "volcano",
      badge: "⚠️ SĐT đang hoạt động",
      title: "Số điện thoại đang gắn với công nhân tại xưởng khác",
      detail: msg,
      solution:
        "Xác minh danh tính người sở hữu số điện thoại để tránh đăng ký nhầm hoặc nhảy xưởng.",
    };
  }

  if (
    msg.includes(
      "Không xác định duy nhất đợt theo CCCD, công ty, ngày PV và mã NV",
    )
  ) {
    const factory =
      values["Công ty"] ||
      values["Nhà máy PV"] ||
      "";
    const interviewDate = values["Ngày PV"] || values["Ngày phỏng vấn"] || "";
    return {
      category: "Lệch đợt tuyển dụng",
      color: "orange",
      badge: "Lệch hồ sơ",
      title: `Lệch hồ sơ: File ghi "${factory || "Chưa rõ nhà máy"}" (Ngày PV: ${interviewDate ? formatDate(interviewDate) : "Trống"})`,
      detail: `File Thưởng ghi nhà máy "${factory}", ngày PV "${interviewDate ? formatDate(interviewDate) : ""}". Tuy nhiên trong danh sách tuyển dụng gốc (DS_TONG) không có đợt tuyển tương ứng hoặc ghi nhà máy phỏng vấn khác (VD: Nam Sơn thay vì Goertek).`,
      solution:
        "Kiểm tra công nhân có đổi nhà máy làm việc thực tế hoặc cập nhật ngày PV trong DS_TONG.",
    };
  }

  if (msg.includes("Bản thưởng của đợt đã có; không tự ghi đè")) {
    const month = values["Tháng"] || "";
    return {
      category: "Trùng bản ghi thưởng",
      color: "red",
      badge: "Trùng CSDL",
      title: `Đã có bản thưởng ${month ? `(${month})` : "đợt này"} trong CSDL`,
      detail: `Công nhân này đã có tiền thưởng ${month} từ file nạp trước đó. Hệ thống chặn tự động ghi đè để bảo vệ tài chính không chi trùng 2 lần.`,
      solution:
        "Đối chiếu với bản ghi cũ tại màn hình Quản lý Thưởng để quyết định giữ hay cập nhật.",
    };
  }

  if (msg.includes("Thiếu số CCCD")) {
    return {
      category: "Thiếu CCCD",
      color: "magenta",
      badge: "Thiếu CCCD",
      title: "Không tìm thấy số CCCD hợp lệ",
      detail:
        "Dòng này bị trống cột CCCD hoặc file Thưởng - Phần 2 bị lệch hàng tiêu đề lúc nạp.",
      solution:
        "Kiểm tra lại file Excel gốc và bổ sung số CCCD của người lao động.",
    };
  }

  if (msg.includes("CCCD chưa có hồ sơ; nhập DS_TONG trước")) {
    return {
      category: "Chưa có DS_TONG",
      color: "volcano",
      badge: "Chưa có hồ sơ",
      title: "CCCD chưa tồn tại trong danh sách tuyển dụng",
      detail:
        "Hệ thống tìm không thấy người lao động có số CCCD này trong DS_TONG.",
      solution: "Cần nhập hồ sơ tuyển dụng vào DS_TONG trước khi nạp thưởng.",
    };
  }

  if (
    msg.includes("giữ nguyên mã tình trạng nguồn") ||
    msg.includes("chưa diễn giải")
  ) {
    const match = /giữ nguyên mã tình trạng nguồn ([^;]+);/.exec(msg);
    const code = match ? match[1] : "";
    return {
      category: "Mã viết tắt",
      color: "blue",
      badge: "Mã nguồn",
      title: `Trạng thái gốc viết tắt: "${code}"`,
      detail: `File Excel dùng ký hiệu viết tắt ("${code}"), hệ thống bảo lưu nguyên gốc để không mất dữ liệu.`,
      solution:
        "Có thể chuẩn hóa sang trạng thái chính quy (Đang làm việc, Đã nghỉ việc, Hết hạn hợp đồng).",
    };
  }

  if (msg.includes("Cần ngày nghỉ và lý do nghỉ việc")) {
    return {
      category: "Thiếu ngày nghỉ",
      color: "gold",
      badge: "Thiếu thông tin",
      title: "Ghi nghỉ việc nhưng thiếu Ngày nghỉ / Lý do",
      detail:
        "Hồ sơ ghi nhận nghỉ việc nhưng trên file Excel để trống cột Ngày nghỉ việc hoặc Lý do.",
      solution:
        "Bổ sung ngày làm việc cuối cùng và lý do người lao động nghỉ việc.",
    };
  }

  if (msg.includes("Số điện thoại không hợp lệ")) {
    return {
      category: "SĐT sai định dạng",
      color: "cyan",
      badge: "SĐT sai",
      title: "Số điện thoại không đúng chuẩn 10 số",
      detail:
        "Số điện thoại trong file có thể thiếu chữ số hoặc chứa ký tự đặc biệt.",
      solution: "Kiểm tra và cập nhật lại số điện thoại liên lạc.",
    };
  }

  if (msg.includes("CCCD phải là Text")) {
    return {
      category: "Định dạng CCCD",
      color: "purple",
      badge: "Kiểu dữ liệu",
      title: "Cột CCCD bị lưu dạng Số (Number)",
      detail:
        "Trong Excel cột CCCD bị lưu dạng Số nên có thể mất số 0 ở đầu (VD: 0012... bị thành 12...).",
      solution: "Định dạng lại cột CCCD sang dạng Text trước khi import.",
    };
  }

  return {
    category: "Cảnh báo khác",
    color: "default",
    badge: "Cảnh báo",
    title: msg,
    detail: msg,
    solution: "Kiểm tra đối chiếu với dòng tương ứng trong file Excel gốc.",
  };
}

// Bóc tách thông tin tiền thưởng & tài khoản hiển thị trực quan
function renderBonusOrProfile(v: Record<string, any>) {
  const activeRewards: { label: string; text: string }[] = [];
  for (let i = 1; i <= 7; i++) {
    const val = String(v[`Thưởng lần ${i}`] || "").trim();
    if (val && !/ko có chính sách|ko đạt|không có|k có/i.test(val)) {
      const cleanAmount = val.split("-")[0].trim();
      activeRewards.push({ label: `L${i}`, text: cleanAmount });
    }
  }

  const totalBonus = v["Tổng thưởng"] || "";
  const bank = v["Ngân hàng"] || "";
  const stk = v["STK"] || "";
  const policy = v["Chính sách"] || "";
  const status = v["Tình trạng"] || "";

  if (activeRewards.length > 0 || totalBonus || bank || stk || policy) {
    return (
      <div className="space-y-1 text-xs">
        {totalBonus && (
          <div>
            <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded text-[11px] inline-block">
              Tổng: {totalBonus}
            </span>
          </div>
        )}
        {activeRewards.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {activeRewards.map((rw, idx) => (
              <span
                key={idx}
                className="inline-block bg-emerald-50 text-emerald-800 border border-emerald-200/80 px-1.5 py-0.2 rounded text-[11px] font-medium"
                title={`Thưởng ${rw.label}: ${rw.text}`}
              >
                {rw.label}: {rw.text}
              </span>
            ))}
          </div>
        )}
        {(bank || stk) && (
          <div className="text-[11px] text-slate-600 font-mono flex items-center gap-1">
            <span className="text-slate-400">{bank || "TK"}:</span>
            <span className="font-semibold text-slate-800">{stk || "—"}</span>
          </div>
        )}
        {policy && (
          <div
            className="text-[11px] text-slate-500 truncate max-w-[190px]"
            title={policy}
          >
            CS: {policy}
          </div>
        )}
      </div>
    );
  }

  if (status) {
    return (
      <div className="space-y-1 text-xs">
        <Tag color="blue" className="font-medium m-0">
          {status}
        </Tag>
        {v["Loại HĐ"] && (
          <div className="text-[11px] text-slate-500">{v["Loại HĐ"]}</div>
        )}
      </div>
    );
  }

  return (
    <span className="text-xs text-slate-400 italic">Không có dữ liệu</span>
  );
}

export default function ImportReviewPage() {
  const [data, setData] = useState<{
    warnings: ReviewItem[];
    duplicates: ReviewItem[];
  }>({
    warnings: [],
    duplicates: [],
  });
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [fileFilter, setFileFilter] = useState<string>();
  const [categoryFilter, setCategoryFilter] = useState<string>();
  const [tab, setTab] = useState<"warnings" | "duplicates">("warnings");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [inspectItem, setInspectItem] = useState<ReviewItem | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    try {
      const res = await fetch("/api/import-review", { cache: "no-store" });
      const j = await res.json();
      if (j.success) {
        setData(j.data);
      } else {
        message.error(j.message || "Không thể tải danh sách");
      }
    } catch {
      message.error("Lỗi kết nối khi tải danh sách phân luồng");
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(item: ReviewItem, action: "APPROVE" | "DELETE") {
    try {
      setActionBusy(`${item.id}-${action}`);
      const res = await fetch("/api/import-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          sourceId: item.sourceId,
          row: item.row,
        }),
      });
      const json = await res.json();
      if (json.success) {
        message.success(json.message);
        if (inspectItem?.id === item.id) {
          setInspectItem(null);
        }
        await load();
      } else {
        message.error(json.message || "Không thể thực hiện thao tác");
      }
    } catch {
      message.error("Lỗi kết nối khi xử lý dòng dữ liệu");
    } finally {
      setActionBusy(null);
    }
  }

  useEffect(() => {
    const type = new URLSearchParams(window.location.search).get("type");
    setTab(type === "duplicates" ? "duplicates" : "warnings");
    load();
  }, []);

  const files = useMemo(() => {
    return [
      ...new Set([...data.warnings, ...data.duplicates].map((r) => r.file)),
    ].sort();
  }, [data]);

  const categories = useMemo(() => {
    const list = data[tab] || [];
    const set = new Set<string>();
    for (const item of list) {
      for (const issue of item.issues || []) {
        const exp = explainIssue(issue.message, item.values);
        set.add(exp.category);
      }
    }
    return [...set].sort();
  }, [data, tab]);

  const stats = useMemo(() => {
    const warnList = data.warnings || [];
    const dupList = data.duplicates || [];

    let mismatchCount = 0;
    let missingIdCount = 0;
    let duplicateBonusCount = 0;
    let shorthandStatusCount = 0;

    for (const item of warnList) {
      for (const issue of item.issues || []) {
        if (issue.message.includes("Không xác định duy nhất đợt"))
          mismatchCount++;
        else if (issue.message.includes("Thiếu số CCCD")) missingIdCount++;
        else if (issue.message.includes("giữ nguyên mã tình trạng nguồn"))
          shorthandStatusCount++;
      }
    }

    for (const item of dupList) {
      for (const issue of item.issues || []) {
        if (issue.message.includes("Bản thưởng của đợt đã có"))
          duplicateBonusCount++;
      }
    }

    return {
      warningsTotal: warnList.length,
      duplicatesTotal: dupList.length,
      mismatchCount,
      missingIdCount,
      duplicateBonusCount,
      shorthandStatusCount,
    };
  }, [data]);

  const filteredData = useMemo(() => {
    const list = data[tab] || [];
    const s = search.trim().toLocaleLowerCase("vi");

    return list.filter((r) => {
      if (fileFilter && r.file !== fileFilter) return false;

      if (categoryFilter) {
        const matchesCategory = r.issues.some((i) => {
          const exp = explainIssue(i.message, r.values);
          return exp.category === categoryFilter;
        });
        if (!matchesCategory) return false;
      }

      if (s) {
        const v = r.values || {};
        const fullName = String(
          v["Họ tên"] || v["Họ và tên"] || "",
        ).toLocaleLowerCase("vi");
        const idCard = String(
          v["Số CCCD"] || v["số CCCD"] || v["CCCD"] || "",
        ).toLocaleLowerCase("vi");
        const phone = String(
          v["SĐT"] || v["Số điện thoại"] || "",
        ).toLocaleLowerCase("vi");
        const company = String(
          v["Công ty"] || v["Nhà máy PV"] || "",
        ).toLocaleLowerCase("vi");
        const issuesText = r.issues
          .map((i) => i.message)
          .join(" ")
          .toLocaleLowerCase("vi");

        return (
          fullName.includes(s) ||
          idCard.includes(s) ||
          phone.includes(s) ||
          company.includes(s) ||
          issuesText.includes(s)
        );
      }

      return true;
    });
  }, [data, tab, fileFilter, categoryFilter, search]);

  const columns: ColumnsType<ReviewItem> = [
    {
      title: "STT",
      key: "stt",
      width: 55,
      align: "center",
      fixed: "left",
      render: (_, __, index) => (
        <span className="font-semibold text-slate-500 text-xs">
          {(currentPage - 1) * pageSize + index + 1}
        </span>
      ),
    },
    {
      title: "Người lao động",
      key: "worker",
      width: 190,
      fixed: "left",
      render: (_, r) => {
        const v = r.values || {};
        const fullName = v["Họ tên"] || v["Họ và tên"] || "—";
        const idCard = v["Số CCCD"] || v["số CCCD"] || v["CCCD"] || "";
        const phone = v["SĐT"] || v["Số điện thoại"] || "";

        return (
          <div className="space-y-0.5">
            <div
              className="font-bold text-slate-900 text-xs truncate max-w-[170px]"
              title={fullName}
            >
              {fullName}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {idCard ? (
                <span className="font-mono text-[11px] font-semibold text-blue-700 bg-blue-50 px-1 py-0.2 rounded">
                  {idCard}
                </span>
              ) : (
                <span className="text-[11px] text-red-500 italic font-medium">
                  [Thiếu CCCD]
                </span>
              )}
              {phone && (
                <span className="text-[10px] text-slate-400">{phone}</span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      title: "Nhà máy & Đợt",
      key: "factory",
      width: 160,
      render: (_, r) => {
        const v = r.values || {};
        const factory =
          v["Công ty"] || v["Nhà máy PV"] || "—";
        const interviewDate = v["Ngày PV"] || v["Ngày phỏng vấn"] || "";
        const month = v["Tháng"] || v["Tháng nhận việc"] || "";

        return (
          <div className="text-xs space-y-0.5">
            <div
              className="font-semibold text-slate-800 truncate max-w-[145px]"
              title={factory}
            >
              {factory}
            </div>
            <div className="text-[11px] text-slate-500">
              {interviewDate ? `PV: ${formatDate(interviewDate)}` : ""}
              {interviewDate && month ? " • " : ""}
              {month ? `${month}` : ""}
            </div>
          </div>
        );
      },
    },
    {
      title: "File nguồn & Dòng",
      key: "source",
      width: 175,
      render: (_, r) => (
        <div className="text-xs space-y-0.5">
          <Tag
            color="cyan"
            className="font-semibold text-[11px] max-w-[155px] truncate m-0 block"
            title={r.file}
          >
            {r.file}
          </Tag>
          <div className="text-[11px] text-slate-500">
            Dòng <strong className="text-slate-700">{r.row}</strong>
            {r.sheet ? ` (${r.sheet})` : ""}
          </div>
        </div>
      ),
    },
    {
      title: "Khoản thưởng / Hồ sơ",
      key: "bonusContent",
      width: 210,
      render: (_, r) => renderBonusOrProfile(r.values || {}),
    },
    {
      title: "Nguyên nhân chi tiết & Hướng xử lý",
      key: "issues",
      width: 420,
      render: (_, r) => {
        return (
          <div className="space-y-1.5 py-0.5">
            {r.issues.map((i, idx) => {
              const exp = explainIssue(i.message, r.values);
              return (
                <div
                  key={idx}
                  className="rounded-md border border-slate-200 bg-slate-50/80 p-2 text-xs space-y-1"
                >
                  <div className="flex items-start gap-1.5 flex-wrap">
                    <Tag
                      color={exp.color}
                      className="font-semibold text-[11px] m-0 shrink-0"
                    >
                      {exp.badge}
                    </Tag>
                    <span className="font-bold text-slate-800 text-xs leading-snug">
                      {exp.title}
                    </span>
                  </div>
                  <div className="text-slate-600 text-[11px] leading-relaxed">
                    {exp.detail}
                  </div>
                  <div className="text-amber-800 font-medium bg-amber-50/90 px-2 py-0.5 rounded text-[11px] flex items-center gap-1.5 border border-amber-200/50">
                    <Info className="w-3 h-3 shrink-0 text-amber-600" />
                    <span>Hướng xử lý: {exp.solution}</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      },
    },
    {
      title: "Thao tác",
      key: "actions",
      width: 215,
      fixed: "right",
      align: "center",
      render: (_, r) => (
        <div className="flex items-center justify-center gap-1.5 flex-wrap">
          <Button
            size="small"
            icon={<Eye className="w-3.5 h-3.5" />}
            onClick={() => setInspectItem(r)}
            className="text-xs font-medium text-blue-600 border-blue-200 bg-blue-50/60 hover:bg-blue-100"
          >
            Kiểm tra
          </Button>
          <Popconfirm
            title="Duyệt và ghi nhận dòng dữ liệu này?"
            description="Hệ thống sẽ cập nhật/ghi đè dữ liệu từ dòng Excel này vào CSDL chính thức và đóng cảnh báo."
            onConfirm={() => handleAction(r, "APPROVE")}
            okText="Duyệt ghi nhận"
            cancelText="Hủy"
          >
            <Button
              size="small"
              type="primary"
              loading={actionBusy === `${r.id}-APPROVE`}
              icon={<Check className="w-3.5 h-3.5" />}
              className="text-xs font-medium bg-emerald-600 hover:bg-emerald-700"
            >
              Duyệt
            </Button>
          </Popconfirm>
          <Popconfirm
            title="Xóa dòng dữ liệu cảnh báo/trùng này?"
            description={`Loại bỏ dòng #${r.row} (${r.file}) khỏi danh sách chờ kiểm tra?`}
            onConfirm={() => handleAction(r, "DELETE")}
            okText="Xóa dòng"
            cancelText="Hủy"
            okButtonProps={{ danger: true }}
          >
            <Button
              size="small"
              danger
              loading={actionBusy === `${r.id}-DELETE`}
              icon={<Trash2 className="w-3.5 h-3.5" />}
              className="text-xs font-medium"
            >
              Xóa
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header & Tiêu đề */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <ShieldAlert className="w-6 h-6 text-indigo-600" />
            <span>Phân luồng & Kiểm tra dữ liệu Import</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Minh bạch hóa các dòng dữ liệu bị lệch hồ sơ hoặc có nguy cơ trùng
            lặp tiền thưởng khi nạp Excel.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Popconfirm
            title="Xóa toàn bộ lịch sử kiểm tra"
            description="Bạn có chắc muốn dọn sạch toàn bộ các lượt nạp và bản ghi kiểm tra nguồn không?"
            onConfirm={async () => {
              try {
                setBusy(true);
                const res = await fetch("/api/import-review", {
                  method: "DELETE",
                });
                const json = await res.json();
                if (json.success) {
                  message.success(json.message);
                  setData({ warnings: [], duplicates: [] });
                } else {
                  message.error(json.message);
                }
              } catch {
                message.error("Không thể xóa lịch sử kiểm tra");
              } finally {
                setBusy(false);
              }
            }}
            okText="Xóa sạch"
            cancelText="Hủy"
            okButtonProps={{ danger: true }}
          >
            <Button
              danger
              icon={<Trash2 className="w-3.5 h-3.5" />}
              size="middle"
              className="font-medium"
            >
              Xóa lịch sử kiểm tra
            </Button>
          </Popconfirm>
          <Button
            icon={
              <RefreshCw
                className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`}
              />
            }
            onClick={load}
            loading={busy}
            size="middle"
            className="font-medium"
          >
            Làm mới
          </Button>
        </div>
      </div>

      {/* Thẻ thống kê nhanh (KPI Overview Cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          size="small"
          className="shadow-xs border-amber-200 bg-amber-50/40"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
              Cảnh báo dữ liệu
            </span>
            <AlertCircle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-slate-900">
            {stats.warningsTotal.toLocaleString("vi-VN")}
            <span className="text-xs font-normal text-slate-500 ml-1">
              dòng
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-600 truncate">
            Giữ an toàn trong hệ thống để đối chiếu
          </p>
        </Card>

        <Card size="small" className="shadow-xs border-red-200 bg-red-50/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-red-700">
              Trùng lặp chờ duyệt
            </span>
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-slate-900">
            {stats.duplicatesTotal.toLocaleString("vi-VN")}
            <span className="text-xs font-normal text-slate-500 ml-1">
              dòng
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-600 truncate">
            Chặn ghi đè tránh chi trả 2 lần
          </p>
        </Card>

        <Card size="small" className="shadow-xs border-blue-200 bg-blue-50/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
              Lệch đợt tuyển dụng
            </span>
            <Users className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-slate-900">
            {stats.mismatchCount.toLocaleString("vi-VN")}
            <span className="text-xs font-normal text-slate-500 ml-1">
              dòng
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-600 truncate">
            Lệch Nhà máy hoặc Ngày PV với DS_TONG
          </p>
        </Card>

        <Card
          size="small"
          className="shadow-xs border-purple-200 bg-purple-50/40"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-purple-700">
              Thiếu số CCCD
            </span>
            <Coins className="w-4 h-4 text-purple-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-slate-900">
            {stats.missingIdCount.toLocaleString("vi-VN")}
            <span className="text-xs font-normal text-slate-500 ml-1">
              dòng
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-600 truncate">
            Thưởng - Phần 2 bị lệch hàng tiêu đề
          </p>
        </Card>
      </div>

      {/* Alert hướng dẫn ngắn gọn */}
      {tab === "warnings" ? (
        <Alert
          type="warning"
          showIcon
          message="Luồng Cảnh báo Dữ liệu: Dữ liệu bị lệch nhà máy/ngày PV hoặc thiếu trường. Toàn bộ dòng vẫn được lưu giữ an toàn để đối chiếu."
          className="text-xs py-1.5"
        />
      ) : (
        <Alert
          type="error"
          showIcon
          message="Luồng Trùng lặp Chờ duyệt: Đã tồn tại bản thưởng cùng CCCD, tháng và công ty. Hệ thống chặn ghi đè để không chi trùng tiền."
          className="text-xs py-1.5"
        />
      )}

      {/* Thanh bộ lọc (Filter Toolbar) */}
      <Card size="small" className="shadow-xs border-slate-200">
        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            prefix={<Search className="w-3.5 h-3.5 text-slate-400" />}
            className="w-full sm:w-64"
            size="middle"
            placeholder="Tìm Họ tên, CCCD, SĐT, Nhà máy..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            allowClear
          />

          <Select
            className="w-full sm:w-56"
            size="middle"
            allowClear
            placeholder="File nguồn"
            value={fileFilter}
            onChange={(val) => {
              setFileFilter(val);
              setCurrentPage(1);
            }}
            options={files.map((f) => ({ value: f, label: f }))}
          />

          <Select
            className="w-full sm:w-56"
            size="middle"
            allowClear
            placeholder="Phân loại lỗi"
            value={categoryFilter}
            onChange={(val) => {
              setCategoryFilter(val);
              setCurrentPage(1);
            }}
            options={categories.map((c) => ({ value: c, label: c }))}
          />

          {(search || fileFilter || categoryFilter) && (
            <Button
              size="middle"
              onClick={() => {
                setSearch("");
                setFileFilter(undefined);
                setCategoryFilter(undefined);
                setCurrentPage(1);
              }}
              className="text-xs"
            >
              Đặt lại
            </Button>
          )}

          <div className="ml-auto text-xs text-slate-500 font-medium">
            Hiển thị{" "}
            <strong>{filteredData.length.toLocaleString("vi-VN")}</strong> /{" "}
            {data[tab].length.toLocaleString("vi-VN")} dòng
          </div>
        </div>
      </Card>

      {/* Tabs chuyển đổi giữa Cảnh báo và Trùng lặp */}
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setTab(key as any);
          setCategoryFilter(undefined);
          setCurrentPage(1);
        }}
        type="card"
        items={[
          {
            key: "warnings",
            label: (
              <span className="flex items-center gap-2 px-1">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span className="font-semibold">Cảnh báo dữ liệu</span>
                <Badge
                  count={data.warnings.length}
                  overflowCount={99999}
                  className="ml-1"
                  style={{ backgroundColor: "#f59e0b" }}
                />
              </span>
            ),
            children: (
              <Table<ReviewItem>
                rowKey="id"
                size="middle"
                loading={busy}
                scroll={{ x: 1440 }}
                dataSource={filteredData}
                columns={columns}
                pagination={{
                  current: currentPage,
                  pageSize,
                  total: filteredData.length,
                  onChange: (page, size) => {
                    setCurrentPage(page);
                    setPageSize(size);
                  },
                  showSizeChanger: true,
                  pageSizeOptions: ["10", "20", "50", "100"],
                  showTotal: (total, range) =>
                    `${range[0]}-${range[1]} trên tổng số ${total} dòng`,
                }}
                expandable={{
                  expandedRowRender: (r) => (
                    <div className="p-3 bg-slate-50/95 rounded-lg border border-slate-200 space-y-2">
                      <div className="font-semibold text-xs text-slate-700 flex items-center gap-1.5">
                        <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                        <span>
                          Toàn bộ các cột nguyên gốc trong Excel (Dòng {r.row} -
                          Sheet: {r.sheet || "Mặc định"}):
                        </span>
                      </div>
                      <Table<any>
                        rowKey="column"
                        size="small"
                        pagination={false}
                        dataSource={Object.entries(r.values || {}).map(
                          ([column, value]) => ({
                            column,
                            value: value ?? "",
                          }),
                        )}
                        columns={[
                          {
                            title: "Tên cột trong Excel",
                            dataIndex: "column",
                            width: 240,
                            render: (v) => (
                              <strong className="text-slate-800 text-xs">
                                {v}
                              </strong>
                            ),
                          },
                          {
                            title: "Giá trị ghi nhận từ file",
                            dataIndex: "value",
                            render: (v, record) => (
                              <span
                                className={
                                  v
                                    ? "text-slate-900 font-medium text-xs"
                                    : "text-slate-400 italic text-xs"
                                }
                              >
                                {v
                                  ? /ngày|date/i.test(String(record.column))
                                    ? formatDate(v)
                                    : v
                                  : "(Trống)"}
                              </span>
                            ),
                          },
                        ]}
                      />
                    </div>
                  ),
                }}
              />
            ),
          },
          {
            key: "duplicates",
            label: (
              <span className="flex items-center gap-2 px-1">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span className="font-semibold">Trùng lặp chờ duyệt</span>
                <Badge
                  count={data.duplicates.length}
                  overflowCount={99999}
                  className="ml-1"
                  style={{ backgroundColor: "#ef4444" }}
                />
              </span>
            ),
            children: (
              <Table<ReviewItem>
                rowKey="id"
                size="middle"
                loading={busy}
                scroll={{ x: 1440 }}
                dataSource={filteredData}
                columns={columns}
                pagination={{
                  current: currentPage,
                  pageSize,
                  total: filteredData.length,
                  onChange: (page, size) => {
                    setCurrentPage(page);
                    setPageSize(size);
                  },
                  showSizeChanger: true,
                  pageSizeOptions: ["10", "20", "50", "100"],
                  showTotal: (total, range) =>
                    `${range[0]}-${range[1]} trên tổng số ${total} dòng`,
                }}
                expandable={{
                  expandedRowRender: (r) => (
                    <div className="p-3 bg-slate-50/95 rounded-lg border border-slate-200 space-y-2">
                      <div className="font-semibold text-xs text-slate-700 flex items-center gap-1.5">
                        <FileSpreadsheet className="w-4 h-4 text-red-600" />
                        <span>
                          Đối chiếu bản ghi Excel trùng lặp (Dòng {r.row} -
                          Sheet: {r.sheet || "Mặc định"}):
                        </span>
                      </div>
                      <Table<any>
                        rowKey="column"
                        size="small"
                        pagination={false}
                        dataSource={Object.entries(r.values || {}).map(
                          ([column, value]) => ({
                            column,
                            value: String(value ?? ""),
                          }),
                        )}
                        columns={[
                          {
                            title: "Tên cột trong Excel",
                            dataIndex: "column",
                            width: 240,
                            render: (v) => (
                              <strong className="text-slate-800 text-xs">
                                {v}
                              </strong>
                            ),
                          },
                          {
                            title: "Giá trị ghi nhận từ file",
                            dataIndex: "value",
                            render: (v) => (
                              <span
                                className={
                                  v
                                    ? "text-slate-900 font-medium text-xs"
                                    : "text-slate-400 italic text-xs"
                                }
                              >
                                {v || "(Trống)"}
                              </span>
                            ),
                          },
                        ]}
                      />
                    </div>
                  ),
                }}
              />
            ),
          },
        ]}
      />

      {/* Modal Kiểm tra & Đối chiếu chi tiết 2 cột (CSDL vs File Excel) */}
      <Modal
        open={!!inspectItem}
        onCancel={() => setInspectItem(null)}
        width={840}
        title={
          <div className="flex items-center gap-2 text-slate-900">
            <ArrowRightLeft className="w-5 h-5 text-indigo-600" />
            <span>
              Kiểm tra chi tiết dòng #{inspectItem?.row} ({inspectItem?.file})
            </span>
          </div>
        }
        footer={
          inspectItem ? (
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <Button onClick={() => setInspectItem(null)}>Đóng</Button>
              <div className="flex items-center gap-2">
                <Popconfirm
                  title="Xóa dòng dữ liệu này?"
                  description={`Loại bỏ dòng #${inspectItem.row} (${inspectItem.file}) khỏi danh sách chờ kiểm tra?`}
                  onConfirm={() => handleAction(inspectItem, "DELETE")}
                  okText="Xóa dòng"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    danger
                    loading={actionBusy === `${inspectItem.id}-DELETE`}
                    icon={<Trash2 className="w-4 h-4" />}
                  >
                    Xóa dòng này
                  </Button>
                </Popconfirm>
                <Popconfirm
                  title="Duyệt và ghi nhận dòng dữ liệu này?"
                  description="Hệ thống sẽ cập nhật/ghi đè dữ liệu từ dòng Excel này vào CSDL chính thức và đóng cảnh báo."
                  onConfirm={() => handleAction(inspectItem, "APPROVE")}
                  okText="Duyệt ghi nhận"
                  cancelText="Hủy"
                >
                  <Button
                    type="primary"
                    loading={actionBusy === `${inspectItem.id}-APPROVE`}
                    icon={<Check className="w-4 h-4" />}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    Duyệt & Ghi nhận vào CSDL
                  </Button>
                </Popconfirm>
              </div>
            </div>
          ) : null
        }
      >
        {inspectItem && (
          <div className="space-y-4 mt-2">
            {/* Lý do cảnh báo / trùng lặp */}
            <div className="space-y-2">
              {inspectItem.issues.map((issue, idx) => {
                const exp = explainIssue(issue.message, inspectItem.values);
                return (
                  <div
                    key={idx}
                    className="p-3 rounded-xl border border-amber-200 bg-amber-50/80 text-xs space-y-1"
                  >
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <Tag color={exp.color} className="m-0 font-bold">
                        {exp.badge}
                      </Tag>
                      <span>{exp.title}</span>
                    </div>
                    <div className="text-slate-700">{exp.detail}</div>
                    <div className="text-emerald-800 font-semibold pt-0.5">
                      👉 Khi bấm &ldquo;Duyệt&rdquo;: Hệ thống sẽ lấy dữ liệu ở
                      cột bên phải (File Excel dòng #{inspectItem.row}) để cập
                      nhật/ghi nhận vào CSDL chính thức.
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bảng đối chiếu 2 cột: CSDL hiện có vs File Excel dòng #row */}
            {(() => {
              const v = inspectItem.values || {};
              const ex = inspectItem.existingRecord || {};
              const hasExisting = !!inspectItem.existingRecord;

              const excelFields: {
                label: string;
                dbVal: string;
                excelVal: string;
              }[] = [
                {
                  label: "Họ và tên",
                  dbVal: ex.fullName || "—",
                  excelVal: String(v["Họ tên"] || v["Họ và tên"] || "—"),
                },
                {
                  label: "Số CCCD",
                  dbVal: ex.idCard || "—",
                  excelVal: String(
                    v["Số CCCD"] || v["số CCCD"] || v["CCCD"] || "—",
                  ),
                },
                {
                  label: "Số điện thoại",
                  dbVal: ex.phone || "—",
                  excelVal: String(v["SĐT"] || v["Số điện thoại"] || "—"),
                },
                {
                  label: "Mã nhân viên",
                  dbVal: ex.employeeCode || "—",
                  excelVal: String(v["Mã NV"] || v["Mã nhân viên"] || "—"),
                },
                {
                  label: "Nhà máy / Công ty",
                  dbVal: ex.factory || "—",
                  excelVal: String(
                    v["Công ty"] ||
                      v["Nhà máy PV"] ||
                      "—",
                  ),
                },
                {
                  label: "Ngày phỏng vấn",
                  dbVal:
                    ex.interviewDate && ex.interviewDate !== "—"
                      ? formatDate(ex.interviewDate)
                      : "—",
                  excelVal:
                    v["Ngày PV"] || v["Ngày phỏng vấn"]
                      ? formatDate(v["Ngày PV"] || v["Ngày phỏng vấn"])
                      : "—",
                },
                {
                  label: "Trạng thái làm việc",
                  dbVal: ex.status || "—",
                  excelVal: String(v["Tình trạng"] || "—"),
                },
                {
                  label: "Tháng thưởng / Đợt",
                  dbVal: ex.month || "—",
                  excelVal: String(v["Tháng"] || v["Tháng nhận việc"] || "—"),
                },
                {
                  label: "Tổng thưởng",
                  dbVal: ex.totalBonus || "—",
                  excelVal: String(v["Tổng thưởng"] || "—"),
                },
                {
                  label: "Chi tiết các lần thưởng",
                  dbVal: ex.bonusDetails || "—",
                  excelVal:
                    [1, 2, 3, 4, 5, 6, 7]
                      .map((n) =>
                        v[`Thưởng lần ${n}`]
                          ? `L${n}: ${v[`Thưởng lần ${n}`]}`
                          : null,
                      )
                      .filter(Boolean)
                      .join(" | ") || "—",
                },
                {
                  label: "Ngân hàng / Số TK",
                  dbVal:
                    ex.bankName || ex.bankAccount
                      ? `${ex.bankName || ""} - ${ex.bankAccount || ""}`
                      : "—",
                  excelVal:
                    v["Ngân hàng"] || v["STK"]
                      ? `${v["Ngân hàng"] || ""} - ${v["STK"] || ""}`
                      : "—",
                },
                {
                  label: "Người tuyển dụng",
                  dbVal: ex.recruiter || "—",
                  excelVal: String(v["Người tuyển"] || "—"),
                },
              ];

              return (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-12 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700">
                    <div className="col-span-3 p-2.5 border-r border-slate-200">
                      Trường đối chiếu
                    </div>
                    <div className="col-span-4 p-2.5 border-r border-slate-200 text-blue-800 bg-blue-50/60">
                      1. Dữ liệu đang có trong CSDL{" "}
                      {!hasExisting && "(Chưa có hồ sơ khớp CCCD)"}
                    </div>
                    <div className="col-span-5 p-2.5 text-indigo-800 bg-indigo-50/60">
                      2. Dữ liệu từ Excel ({inspectItem.file} - Dòng #
                      {inspectItem.row})
                    </div>
                  </div>
                  <div className="divide-y divide-slate-200 text-xs">
                    {excelFields.map((f, i) => {
                      const isDiff =
                        hasExisting &&
                        f.dbVal !== "—" &&
                        f.excelVal !== "—" &&
                        f.dbVal !== f.excelVal;
                      const isSameKey =
                        hasExisting &&
                        f.label === "Số CCCD" &&
                        f.dbVal === f.excelVal &&
                        f.dbVal !== "—";
                      return (
                        <div
                          key={i}
                          className={`grid grid-cols-12 items-center ${
                            isDiff
                              ? "bg-rose-50/70"
                              : isSameKey
                                ? "bg-amber-50/60"
                                : "bg-white"
                          }`}
                        >
                          <div className="col-span-3 p-2.5 font-semibold text-slate-600 border-r border-slate-200 flex items-center justify-between">
                            <span>{f.label}</span>
                            {isDiff && (
                              <Tag
                                color="red"
                                className="m-0 text-[10px] px-1 leading-tight"
                              >
                                Khác biệt
                              </Tag>
                            )}
                            {isSameKey && (
                              <Tag
                                color="orange"
                                className="m-0 text-[10px] px-1 leading-tight"
                              >
                                Trùng mã
                              </Tag>
                            )}
                          </div>
                          <div className="col-span-4 p-2.5 border-r border-slate-200 font-medium text-slate-800 break-words">
                            {f.dbVal}
                          </div>
                          <div className="col-span-5 p-2.5 font-semibold text-slate-900 break-words">
                            {f.excelVal}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>
    </div>
  );
}
