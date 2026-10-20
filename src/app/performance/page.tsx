'use client';

import { useEffect, useState, useMemo } from 'react';
import { Card, Table, Input, Select, Button, Tag, Progress, Empty, message, Checkbox, Modal, DatePicker, Segmented } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useIdentity } from '@/components/AuthGate';
import {
  Award,
  TrendingUp,
  Users,
  Target,
  Filter,
  RotateCcw,
  Medal,
  Search,
  CheckCircle2,
  Building,
  UserPlus,
  Sparkles,
  Download,
  Star,
  UserCheck,
  Calendar,
  SlidersHorizontal
} from 'lucide-react';

const pct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`);

const dateKey = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!iso && !vn) return null;
  const y = Number(iso ? iso[1] : vn![3]),
    m = Number(iso ? iso[2] : vn![2]),
    d = Number(iso ? iso[3] : vn![1]);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

const diffDays = (startStr: string | null | undefined, endStr: string | null | undefined): number | null => {
  const sKey = dateKey(startStr);
  const eKey = dateKey(endStr);
  if (!sKey || !eKey) return null;
  const sTime = new Date(sKey).getTime();
  const eTime = new Date(eKey).getTime();
  if (Number.isNaN(sTime) || Number.isNaN(eTime)) return null;
  return Math.round((eTime - sTime) / 86400000);
};

const isPassed = (a: any) => {
  if (a.interviewResult === 'PASS') return true;
  const s = String(a.status || '').trim().toLowerCase();
  if (['lv', 'đang làm việc', 'chuyển chính thức', 'đang lv', 'đang đào tạo'].includes(s)) return true;
  if (['nh', 'nghỉ hẳn', 'hết phí', 'hhđ', 'hết hợp đồng', 'tự ý nghỉ việc', 'đã nghỉ việc', 'đạt phỏng vấn', 'đỗ - ko tính', 'gtnb'].includes(s)) return true;
  return false;
};

const isFailed = (a: any) => {
  if (a.interviewResult === 'FAIL') return true;
  const s = String(a.status || '').trim().toLowerCase();
  return s.startsWith('trượt') || s.includes('trượt ksk') || s.includes('trượt pv');
};

const isAbandon = (a: any) => {
  if (a.interviewResult === 'ABANDONED') return true;
  const s = String(a.status || '').trim().toLowerCase();
  return s.startsWith('bỏ') || s.includes('bỏ xx') || s.includes('bỏ đt');
};

// Đạt >= 10 công: Đang làm việc, Hết phí, HHĐ, confirmedWorkDays >= 10, hoặc (Ngày NH - Ngày PV/nhận việc) >= 10 ngày
const isWorking = (a: any) => {
  if (!isPassed(a)) return false;
  const s = String(a.status || '').trim().toLowerCase();
  if (['lv', 'đang làm việc', 'chuyển chính thức', 'đang lv', 'hết phí', 'hhđ', 'hết hợp đồng'].includes(s)) {
    return true;
  }
  if (a.confirmedWorkDays != null && a.confirmedWorkDays >= 10) return true;
  const days = diffDays(a.startDate || a.interviewDate, a.leaveDate);
  if (days != null && days >= 10) return true;
  return false;
};

// Nghỉ < 10 ngày: Đã đỗ PV nhưng chưa đạt 10 công và có ngày nghỉ < 10 ngày (hoặc trạng thái nghỉ hẳn không đủ 10 ngày)
const isQuitBefore10 = (a: any) => {
  if (!isPassed(a) || isWorking(a)) return false;
  const days = diffDays(a.startDate || a.interviewDate, a.leaveDate);
  if (days != null && days >= 0 && days < 10) return true;
  const s = String(a.status || '').trim().toLowerCase();
  return ['nh', 'nghỉ hẳn', 'tự ý nghỉ việc', 'đã nghỉ việc'].includes(s);
};

const monthOf = (value: string | null | undefined): string => {
  if (!value) return 'UNKNOWN';
  const dk = dateKey(value);
  return dk ? dk.slice(0, 7) : 'UNKNOWN';
};

export default function PerformanceEvaluationPage() {
  const user = useIdentity();
  const [data, setData] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [catalogTeams, setCatalogTeams] = useState<any[]>([]);
  const [catalogRecruiters, setCatalogRecruiters] = useState<any[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Demographics scope filter
  const [demoScopeType, setDemoScopeType] = useState<'ALL' | 'TEAM' | 'RECRUITER'>('ALL');
  const [demoScopeValue, setDemoScopeValue] = useState<string>('');
  const [demoData, setDemoData] = useState<any>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  // Interactive controls
  const [monthlyMetric, setMonthlyMetric] = useState<'achieved' | 'rate' | 'per_recruiter' | 'contribution'>('achieved');
  const [recruiterSearch, setRecruiterSearch] = useState('');
  const [onlyWithKpi, setOnlyWithKpi] = useState(false);
  const [hoveredRecruiter, setHoveredRecruiter] = useState<any>(null);
  const [selectedRecruiter, setSelectedRecruiter] = useState<any>(null);
  const [modalSearch, setModalSearch] = useState('');
  const [modalStatusFilter, setModalStatusFilter] = useState<string>('ALL');
  const [groupFilter, setGroupFilter] = useState<'ALL' | 'STAR' | 'QUALITY' | 'VOLUME' | 'SUPPORT'>('ALL');
  const [showAllBars, setShowAllBars] = useState(false);
  const [kpiViewMode, setKpiViewMode] = useState<'FACTORY' | 'MONTH'>('FACTORY');
  const [hoveredBarItem, setHoveredBarItem] = useState<any>(null);
  const [dateFilterMode, setDateFilterMode] = useState<'RANGE' | 'DAY' | 'MONTH'>('RANGE');

  // 1. Tải báo cáo tổng
  async function loadReports() {
    setBusy(true);
    try {
      const q = new URLSearchParams(filters).toString();
      const res = await fetch(`/api/reports?${q}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        message.error(json.message || 'Không thể tải dữ liệu báo cáo');
      }
    } catch {
      message.error('Lỗi kết nối máy chủ');
    } finally {
      setBusy(false);
    }
  }

  // 2. Tải danh mục ban đầu
  useEffect(() => {
    loadReports();
    Promise.all([
      fetch('/api/orders').then(r => r.json()),
      fetch('/api/workers').then(r => r.json()),
      fetch('/api/catalogs?kind=TEAM').then(r => r.json()),
      fetch('/api/catalogs?kind=RECRUITER').then(r => r.json()),
    ]).then(([o, w, t, rec]) => {
      setOrders(o.data || []);
      setWorkers(w.data || []);
      setCatalogTeams(t.data || []);
      setCatalogRecruiters(rec.data || []);
    }).catch(() => {});
  }, []);

  // Tự động tải lại khi đổi bộ lọc chính
  useEffect(() => {
    loadReports();
  }, [filters]);

  // 3. Tải dữ liệu chân dung riêng biệt khi đổi bộ lọc Chân dung
  useEffect(() => {
    async function loadDemographics() {
      if (demoScopeType === 'ALL') {
        setDemoData(data?.recruitment?.demographics || null);
        return;
      }
      if (!demoScopeValue) return;

      setDemoBusy(true);
      try {
        const queryParams = new URLSearchParams({
          ...filters,
          ...(demoScopeType === 'TEAM' ? { team: demoScopeValue } : { recruiter: demoScopeValue })
        });
        const res = await fetch(`/api/reports?${queryParams.toString()}`);
        const json = await res.json();
        if (json.success) {
          setDemoData(json.data?.recruitment?.demographics || null);
        }
      } catch {
        message.error('Không thể tải chân dung nhân sự theo bộ lọc');
      } finally {
        setDemoBusy(false);
      }
    }

    if (data?.recruitment) {
      loadDemographics();
    }
  }, [demoScopeType, demoScopeValue, data, filters]);

  const setFilter = (key: string, val: string) => {
    setFilters(prev => ({ ...prev, [key]: val || '' }));
  };

  const factoryNames = useMemo(() => {
    return [
      ...new Set([
        ...orders.map(o => o.factory),
        ...workers.flatMap(w => (w.assignments || []).map((a: any) => a.interviewFactory)),
      ]),
    ].filter(Boolean);
  }, [orders, workers]);

  // Ánh xạ chuyên viên -> Team từ Catalog hoặc từ hồ sơ worker
  const recruiterTeamMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workers) {
      if (w.recruiter && w.team && w.team.trim()) {
        map.set(w.recruiter.trim().toLowerCase(), w.team.trim());
      }
    }
    for (const r of catalogRecruiters) {
      if (r.name && r.team?.name) map.set(r.name.trim().toLowerCase(), r.team.name);
    }
    return map;
  }, [catalogRecruiters, workers]);

  const resolveTeam = (a: any): string => {
    if (a.team && String(a.team).trim()) return String(a.team).trim();
    if (a.worker?.team && String(a.worker.team).trim()) return String(a.worker.team).trim();
    const recKey = String(a.recruiter || a.worker?.recruiter || '').trim().toLowerCase();
    if (recKey && recruiterTeamMap.has(recKey)) return recruiterTeamMap.get(recKey)!;
    return 'Chưa gán';
  };

  // Toàn bộ các assignment của hồ sơ hoạt động
  const activeAssignments = useMemo(() => {
    return workers
      .filter(w => !w.archivedAt)
      .flatMap(w => (w.assignments || []).map((a: any) => ({ ...a, worker: w })));
  }, [workers]);

  // Các assignment khớp bộ lọc hiện hành (Khoảng ngày, Ngày, Tháng, Nhà máy PV, Team)
  const filteredAssignments = useMemo(() => {
    return activeAssignments.filter(a => {
      const d = a.interviewDate ? dateKey(a.interviewDate) : null;
      if (filters.from && (!d || d < filters.from)) return false;
      if (filters.to && (!d || d > filters.to)) return false;
      if (filters.month && monthOf(a.interviewDate) !== filters.month) return false;
      if (filters.interviewFactory && a.interviewFactory !== filters.interviewFactory) return false;
      if (filters.team && resolveTeam(a) !== filters.team) return false;
      return true;
    });
  }, [activeAssignments, filters, recruiterTeamMap]);

  // Danh sách các tháng có dữ liệu thực tế (sắp xếp tăng dần theo thời gian)
  const availableMonths = useMemo(() => {
    const rawMonths = data?.recruitment?.months || [];
    const set = new Set<string>();
    rawMonths.forEach((m: any) => {
      if (m.name && m.name !== 'UNKNOWN') set.add(m.name);
    });
    activeAssignments.forEach(a => {
      const mo = monthOf(a.interviewDate);
      if (mo !== 'UNKNOWN') set.add(mo);
    });
    return Array.from(set).sort();
  }, [data, activeAssignments]);

  // =========================================================================
  // 1. DỮ LIỆU THẬT 100%: THẺ ĐIỂM TỪNG TEAM
  // =========================================================================
  const teamCards = useMemo(() => {
    if (!filteredAssignments.length) return [];

    const byTeam = new Map<string, any[]>();
    for (const a of filteredAssignments) {
      const tName = resolveTeam(a);
      const list = byTeam.get(tName) || [];
      list.push(a);
      byTeam.set(tName, list);
    }

    const entries = Array.from(byTeam.entries());
    const allRetained = filteredAssignments.filter(isWorking).length;

    const mapped = entries.map(([teamName, list], idx) => {
      const catalogCount = catalogRecruiters.filter(r => r.team?.name === teamName).length;
      const distinctRecruiters = new Set(list.map(a => (a.recruiter || '').trim()).filter(Boolean)).size;
      const recruitersInTeam = catalogCount || distinctRecruiters || 1;

      const total = list.length;
      const passed = list.filter(isPassed).length;
      const retained10 = list.filter(isWorking).length;
      const quitBefore10 = list.filter(isQuitBefore10).length;
      const failed = list.filter(isFailed).length;
      const abandoned = list.filter(isAbandon).length;

      const retentionRate = passed > 0 ? Math.round((retained10 / passed) * 1000) / 10 : 0;
      const quitBefore10Rate = passed > 0 ? Math.round((quitBefore10 / passed) * 1000) / 10 : 0;
      const failRate = total > 0 ? Math.round((failed / total) * 1000) / 10 : 0;
      const abandonRate = total > 0 ? Math.round((abandoned / total) * 1000) / 10 : 0;
      const perRecruiter = recruitersInTeam > 0 ? Math.round((retained10 / recruitersInTeam) * 10) / 10 : retained10;
      const contribution = allRetained > 0 ? Math.round((retained10 / allRetained) * 100) : 0;

      return {
        id: `T${idx + 1}`,
        name: teamName,
        recruitersCount: recruitersInTeam,
        passed,
        retained10,
        retentionRate,
        failRate,
        abandonRate,
        quitBefore10Rate,
        perRecruiter,
        contribution,
        isTop: false
      };
    });

    // Xác định team có năng suất cao nhất
    let maxNS = -1;
    let topIdx = -1;
    mapped.forEach((t, i) => {
      if (t.perRecruiter > maxNS && t.perRecruiter > 0) {
        maxNS = t.perRecruiter;
        topIdx = i;
      }
    });

    return mapped.map((t, i) => ({
      ...t,
      isTop: i === topIdx
    }));
  }, [filteredAssignments, catalogRecruiters, recruiterTeamMap]);

  // =========================================================================
  // 2. DỮ LIỆU THẬT 100%: TỔNG QUAN TIẾN ĐỘ KPI & BIỂU ĐỒ CỘT SO SÁNH
  // =========================================================================
  const overallKpi = useMemo(() => {
    const total = filteredAssignments.length;
    const passed = filteredAssignments.filter(isPassed).length;
    const retained10 = filteredAssignments.filter(isWorking).length;
    const quit10 = filteredAssignments.filter(isQuitBefore10).length;
    const abandon = filteredAssignments.filter(isAbandon).length;
    const failed = filteredAssignments.filter(isFailed).length;

    const retentionRate = passed > 0 ? Math.round((retained10 / passed) * 1000) / 10 : 0;
    const quit10Rate = passed > 0 ? Math.round((quit10 / passed) * 1000) / 10 : 0;
    const abandonRate = total > 0 ? Math.round((abandon / total) * 1000) / 10 : 0;

    return {
      total,
      passed,
      retained10,
      quit10,
      abandon,
      failed,
      retentionRate,
      quit10Rate,
      abandonRate
    };
  }, [filteredAssignments]);

  // Dữ liệu so sánh cột theo các Nhà máy tiếp nhận (Top nhà máy lớn)
  const factoryChartData = useMemo(() => {
    const byFac = new Map<string, any[]>();
    for (const a of filteredAssignments) {
      const fac = (a.workingFactory || a.interviewFactory || 'Chưa gán').trim() || 'Chưa gán';
      const list = byFac.get(fac) || [];
      list.push(a);
      byFac.set(fac, list);
    }

    const items = Array.from(byFac.entries()).map(([fac, list]) => {
      const total = list.length;
      const passed = list.filter(isPassed).length;
      const retained10 = list.filter(isWorking).length;
      const quit10 = list.filter(isQuitBefore10).length;
      const rate = passed > 0 ? Math.round((retained10 / passed) * 1000) / 10 : 0;
      return { name: fac, total, passed, retained10, quit10, rate };
    });

    return items.sort((a, b) => b.passed - a.passed).slice(0, 8);
  }, [filteredAssignments]);

  // Dữ liệu so sánh cột theo chuỗi thời gian các Tháng
  const monthlyChartData = useMemo(() => {
    const byMo = new Map<string, any[]>();
    for (const a of filteredAssignments) {
      const mo = monthOf(a.interviewDate);
      if (mo !== 'UNKNOWN') {
        const list = byMo.get(mo) || [];
        list.push(a);
        byMo.set(mo, list);
      }
    }

    const items = Array.from(byMo.entries()).map(([mo, list]) => {
      const total = list.length;
      const passed = list.filter(isPassed).length;
      const retained10 = list.filter(isWorking).length;
      const quit10 = list.filter(isQuitBefore10).length;
      const rate = passed > 0 ? Math.round((retained10 / passed) * 1000) / 10 : 0;
      return { name: mo, total, passed, retained10, quit10, rate };
    });

    return items.sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredAssignments]);

  // =========================================================================
  // 3. DỮ LIỆU THẬT 100%: BẢNG XẾP HẠNG CHUYÊN VIÊN TUYỂN DỤNG
  // =========================================================================
  const recruiterLeaderboard = useMemo(() => {
    if (!filteredAssignments.length) return [];

    const byRec = new Map<string, any[]>();
    for (const a of filteredAssignments) {
      const rName = (a.recruiter || 'Chưa gán').trim() || 'Chưa gán';
      const list = byRec.get(rName) || [];
      list.push(a);
      byRec.set(rName, list);
    }

    const rawList = Array.from(byRec.entries()).map(([rName, list]) => {
      const total = list.length;
      const passedList = list.filter(isPassed);
      const passed = passedList.length;
      const retained10 = list.filter(isWorking).length;
      const quit10 = list.filter(isQuitBefore10).length;
      const failed = list.filter(isFailed).length;
      const abandoned = list.filter(isAbandon).length;

      const distinctDays = new Set(passedList.map(a => dateKey(a.interviewDate)).filter(Boolean)).size;
      const activeDays = distinctDays > 0 ? distinctDays : (passed > 0 ? 1 : 0);
      const passedPerDay = activeDays > 0 ? (passed / activeDays).toFixed(1) : '—';

      const passRate = passed > 0 ? Math.round((retained10 / passed) * 1000) / 10 : 0;
      const dropBefore = total > 0 ? Math.round((failed / total) * 1000) / 10 : 0;
      const abandon = total > 0 ? Math.round((abandoned / total) * 1000) / 10 : 0;
      const quitBefore10 = passed > 0 ? Math.round((quit10 / passed) * 1000) / 10 : 0;
      const teamName = resolveTeam(list[0]);

      return {
        name: rName,
        team: teamName,
        total,
        passed,
        retained10,
        quit10Count: quit10,
        failedCount: failed,
        abandonedCount: abandoned,
        assignments: list,
        activeDays,
        passedPerDay,
        dropBefore: `${dropBefore}%`,
        abandon: `${abandon}%`,
        quitBefore10: `${quitBefore10}%`,
        passRate: `${passRate}%`,
        passRateVal: passRate,
        kpiRate: `${Math.round(passRate)}%`,
        kpiRateVal: Math.round(passRate),
        hasKpi: passed > 0
      };
    });

    const sorted = rawList.sort((a, b) => b.passed - a.passed || b.retained10 - a.retained10);
    return sorted.map((item, idx) => ({
      ...item,
      rank: idx + 1
    }));
  }, [filteredAssignments, recruiterTeamMap]);

  const filteredLeaderboard = useMemo(() => {
    return recruiterLeaderboard.filter(item => {
      const matchSearch = !recruiterSearch || item.name.toLowerCase().includes(recruiterSearch.trim().toLowerCase());
      const matchKpi = !onlyWithKpi || item.hasKpi;
      return matchSearch && matchKpi;
    });
  }, [recruiterLeaderboard, recruiterSearch, onlyWithKpi]);

  // Tính trung vị cho Biểu đồ phân tán (Quadrant Scatter)
  const { medianPassed, medianRate } = useMemo(() => {
    const activeRecs = recruiterLeaderboard.filter(r => r.passed > 0);
    const source = activeRecs.length > 0 ? activeRecs : recruiterLeaderboard;
    if (!source.length) return { medianPassed: 0, medianRate: 0 };
    const passedArr = source.map(r => r.passed).sort((a, b) => a - b);
    const rateArr = source.map(r => r.passRateVal).sort((a, b) => a - b);
    const mid = Math.floor(passedArr.length / 2);
    return {
      medianPassed: passedArr[mid] || 0,
      medianRate: rateArr[mid] || 0
    };
  }, [recruiterLeaderboard]);

  // =========================================================================
  // 4. DỮ LIỆU THẬT 100%: HAI CARD ĐỐI SOÁT CHÂN TRANG
  // =========================================================================
  const sourceComparison = useMemo(() => {
    const referralList = filteredAssignments.filter(a => (a.source || '').toLowerCase().includes('giới thiệu'));
    const directList = filteredAssignments.filter(a => !(a.source || '').toLowerCase().includes('giới thiệu'));

    const directPassed = directList.filter(isPassed).length;
    const directWorking = directList.filter(isWorking).length;
    const directRate = directPassed > 0 ? Math.round((directWorking / directPassed) * 1000) / 10 : 0;

    const referralPassed = referralList.filter(isPassed).length;
    const referralWorking = referralList.filter(isWorking).length;
    const referralRate = referralPassed > 0 ? Math.round((referralWorking / referralPassed) * 1000) / 10 : 0;

    return {
      directPassed,
      directRate,
      referralPassed,
      referralRate
    };
  }, [filteredAssignments]);

  // Xuất CSV báo cáo
  const exportToCSV = () => {
    if (!filteredLeaderboard.length) {
      message.warning('Không có dữ liệu để xuất file CSV');
      return;
    }
    const headers = ['#', 'Người tuyển', 'Team', 'Đỗ PV', 'Ngày có đỗ', 'Đỗ/ngày', 'Rớt trước', 'Bỏ xưởng', 'Nghỉ < 10', 'Tỷ lệ đạt', 'KPI đạt %'];
    const rows = filteredLeaderboard.map(r => [
      r.rank,
      r.name,
      r.team,
      r.passed,
      r.activeDays,
      r.passedPerDay,
      r.dropBefore,
      r.abandon,
      r.quitBefore10,
      r.passRate,
      r.kpiRate
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Bao_cao_danh_gia_tuyen_dung_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    message.success('Đã tải xuống file CSV thành công!');
  };

  // Thống kê nhanh và số lượng bộ lọc đang hoạt động
  const activeFilterCount = useMemo(() => {
    const hasDate = Boolean(filters.month || filters.from || filters.to);
    return (hasDate ? 1 : 0) + (filters.interviewFactory ? 1 : 0) + (filters.team ? 1 : 0);
  }, [filters]);

  const isAllDateActive = !filters.from && !filters.to && !filters.month;

  const clearDateFilter = () => {
    setFilters(prev => {
      const next = { ...prev };
      delete next.from;
      delete next.to;
      delete next.month;
      return next;
    });
  };

  const handleRangeChange = (dates: any) => {
    if (!dates || !dates[0] || !dates[1]) {
      clearDateFilter();
      return;
    }
    setFilters(prev => {
      const next = { ...prev };
      delete next.month;
      next.from = dates[0].format('YYYY-MM-DD');
      next.to = dates[1].format('YYYY-MM-DD');
      return next;
    });
  };

  const handleSingleDayChange = (date: any) => {
    if (!date) {
      clearDateFilter();
      return;
    }
    const dStr = date.format('YYYY-MM-DD');
    setFilters(prev => {
      const next = { ...prev };
      delete next.month;
      next.from = dStr;
      next.to = dStr;
      return next;
    });
  };

  const handleMonthChange = (date: any) => {
    if (!date) {
      clearDateFilter();
      return;
    }
    const mStr = date.format('YYYY-MM');
    setFilters(prev => {
      const next = { ...prev };
      delete next.from;
      delete next.to;
      next.month = mStr;
      return next;
    });
  };

  const rangeValue: [Dayjs | null, Dayjs | null] | null = useMemo(() => {
    if (filters.from && filters.to) {
      const s = dayjs(filters.from);
      const e = dayjs(filters.to);
      return [s.isValid() ? s : null, e.isValid() ? e : null];
    }
    return null;
  }, [filters.from, filters.to]);

  const singleDayValue: Dayjs | null = useMemo(() => {
    if (filters.from && filters.from === filters.to) {
      const d = dayjs(filters.from);
      return d.isValid() ? d : null;
    }
    return null;
  }, [filters.from, filters.to]);

  const monthValue: Dayjs | null = useMemo(() => {
    if (filters.month) {
      const m = dayjs(filters.month + '-01');
      return m.isValid() ? m : null;
    }
    return null;
  }, [filters.month]);

  const quickFilterSummary = useMemo(() => {
    const passed = filteredAssignments.filter(isPassed).length;
    const working = filteredAssignments.filter(isWorking).length;
    const rate = passed > 0 ? Math.round((working / passed) * 1000) / 10 : 0;
    return { passed, working, rate };
  }, [filteredAssignments]);

  return (
    <div className="space-y-6 pb-12 bg-slate-50/50 min-h-screen">
      {/* =========================================================================
          1. HEADER CHÍNH & THANH CÔNG CỤ
          ========================================================================= */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">So sánh team</h1>
        <p className="text-xs text-slate-500 mt-1">
          Đánh giá năng suất, hiệu quả giữ chân và tiến độ thực hiện KPI tuyển dụng từ dữ liệu CSDL thực tế.
        </p>
      </div>

      {/* =========================================================================
          2. BỘ LỌC ĐIỀU HÀNH & THANH CÔNG CỤ HIỆN ĐẠI
          ========================================================================= */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Header hàng điều khiển */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-slate-50/70 via-white to-slate-50/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shadow-xs">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-800 tracking-tight">Bộ lọc & Phân tích điều hành</span>
                {activeFilterCount > 0 ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                    Đang lọc {activeFilterCount} tiêu chí
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600">
                    Toàn bộ dữ liệu
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">Tự động đồng bộ và tổng hợp theo thời gian thực từ CSDL hồ sơ ứng viên</p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {activeFilterCount > 0 && (
              <Button
                size="middle"
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                onClick={() => setFilters({})}
                className="text-xs text-slate-600 hover:text-rose-600 hover:border-rose-300 font-medium rounded-lg h-9"
              >
                Đặt lại bộ lọc
              </Button>
            )}
            <Button
              type="primary"
              size="middle"
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={exportToCSV}
              className="bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold rounded-lg h-9 shadow-xs"
            >
              Xuất báo cáo CSV
            </Button>
          </div>
        </div>

        {/* Khối các trường Select lọc chính */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Thời gian phỏng vấn (Type Date/Time Picker + Nút Tất cả) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-blue-500" />
                  <span>Thời gian phỏng vấn</span>
                </label>
                <Segmented
                  size="small"
                  value={dateFilterMode}
                  onChange={(val) => setDateFilterMode(val as any)}
                  options={[
                    { label: 'Khoảng ngày', value: 'RANGE' },
                    { label: 'Theo ngày', value: 'DAY' },
                    { label: 'Theo tháng', value: 'MONTH' }
                  ]}
                />
              </div>

              <div className="flex items-center gap-2">
                {/* Nút Tất cả */}
                <Button
                  size="large"
                  type={isAllDateActive ? 'primary' : 'default'}
                  onClick={clearDateFilter}
                  className={`text-xs font-semibold px-3 shrink-0 ${
                    isAllDateActive
                      ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600'
                      : 'text-slate-600 hover:text-blue-600 border-slate-300'
                  }`}
                  title="Xem toàn bộ thời gian (không lọc theo ngày)"
                >
                  Tất cả
                </Button>

                {/* Date Picker theo chế độ đang chọn */}
                {dateFilterMode === 'RANGE' && (
                  <DatePicker.RangePicker
                    size="large"
                    className="w-full text-xs"
                    format="DD/MM/YYYY"
                    placeholder={['Từ ngày', 'Đến ngày']}
                    value={rangeValue as any}
                    onChange={handleRangeChange}
                    allowClear
                  />
                )}

                {dateFilterMode === 'DAY' && (
                  <DatePicker
                    size="large"
                    className="w-full text-xs"
                    format="DD/MM/YYYY"
                    placeholder="Gõ hoặc chọn ngày (DD/MM/YYYY)"
                    value={singleDayValue}
                    onChange={handleSingleDayChange}
                    allowClear
                  />
                )}

                {dateFilterMode === 'MONTH' && (
                  <DatePicker
                    picker="month"
                    size="large"
                    className="w-full text-xs"
                    format="MM/YYYY"
                    placeholder="Gõ hoặc chọn tháng (MM/YYYY)"
                    value={monthValue}
                    onChange={handleMonthChange}
                    allowClear
                  />
                )}
              </div>
            </div>

            {/* 2. Nhà máy phỏng vấn */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Nhà máy đối tác</span>
                </label>
                {filters.interviewFactory && (
                  <button
                    onClick={() => setFilter('interviewFactory', '')}
                    className="text-[11px] text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    Xóa
                  </button>
                )}
              </div>
              <Select
                size="large"
                className="w-full text-xs"
                placeholder="Tất cả nhà máy"
                value={filters.interviewFactory || undefined}
                onChange={(v) => setFilter('interviewFactory', v || '')}
                allowClear
                showSearch
                optionFilterProp="label"
                options={[
                  { value: '', label: 'Tất cả nhà máy' },
                  ...factoryNames.map((f) => ({ value: f, label: f }))
                ]}
              />
            </div>

            {/* 3. Team tuyển dụng */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-purple-500" />
                  <span>Team tuyển dụng</span>
                </label>
                {filters.team && (
                  <button
                    onClick={() => setFilter('team', '')}
                    className="text-[11px] text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    Xóa
                  </button>
                )}
              </div>
              <Select
                size="large"
                className="w-full text-xs"
                placeholder="Tất cả team"
                value={filters.team || undefined}
                onChange={(v) => setFilter('team', v || '')}
                allowClear
                options={[
                  { value: '', label: 'Tất cả team' },
                  ...catalogTeams.map((t) => ({ value: t.name, label: t.name }))
                ]}
              />
            </div>
          </div>

          {/* Quick Month Chips (Phím tắt chọn nhanh) */}
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-slate-400">Chọn nhanh:</span>
            <button
              onClick={clearDateFilter}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                isAllDateActive
                  ? 'bg-blue-600 text-white shadow-xs font-semibold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Tất cả thời gian
            </button>
            {availableMonths.slice(-6).reverse().map((m) => (
              <button
                key={m}
                onClick={() => setFilter('month', filters.month === m ? '' : m)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  filters.month === m
                    ? 'bg-indigo-600 text-white shadow-xs font-semibold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Tháng {m}
              </button>
            ))}
          </div>

          {/* Danh sách thẻ tag đang lọc (nếu có) */}
          {activeFilterCount > 0 && (
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-slate-400">Đang lọc theo:</span>
              {filters.from && filters.to && (
                <Tag
                  closable
                  onClose={clearDateFilter}
                  className="px-2.5 py-0.5 rounded-md text-xs bg-blue-50 text-blue-700 border-blue-200 flex items-center gap-1"
                >
                  <span>
                    {filters.from === filters.to
                      ? `Ngày: ${dayjs(filters.from).format('DD/MM/YYYY')}`
                      : `Từ ${dayjs(filters.from).format('DD/MM/YYYY')} đến ${dayjs(filters.to).format('DD/MM/YYYY')}`}
                  </span>
                </Tag>
              )}
              {filters.month && (
                <Tag
                  closable
                  onClose={() => setFilter('month', '')}
                  className="px-2.5 py-0.5 rounded-md text-xs bg-blue-50 text-blue-700 border-blue-200 flex items-center gap-1"
                >
                  <span>Tháng: <strong>{filters.month}</strong></span>
                </Tag>
              )}
              {filters.interviewFactory && (
                <Tag
                  closable
                  onClose={() => setFilter('interviewFactory', '')}
                  className="px-2.5 py-0.5 rounded-md text-xs bg-emerald-50 text-emerald-700 border-emerald-200 flex items-center gap-1"
                >
                  <span>Nhà máy: <strong>{filters.interviewFactory}</strong></span>
                </Tag>
              )}
              {filters.team && (
                <Tag
                  closable
                  onClose={() => setFilter('team', '')}
                  className="px-2.5 py-0.5 rounded-md text-xs bg-purple-50 text-purple-700 border-purple-200 flex items-center gap-1"
                >
                  <span>Team: <strong>{filters.team}</strong></span>
                </Tag>
              )}
              <button
                onClick={() => setFilters({})}
                className="text-[11px] text-rose-500 hover:text-rose-700 underline font-medium cursor-pointer ml-1"
              >
                Xóa tất cả
              </button>
            </div>
          )}
        </div>

        {/* Dải thông tin tóm tắt & trạng thái bộ lọc (thay thế hoàn toàn cho hộp vàng cũ) */}
        <div className="bg-slate-50/70 border-t border-slate-100 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-500">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold text-[11px] border border-emerald-200/80">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> CSDL Thực tế
            </span>
            <span className="hidden sm:inline">
              Khảo sát trên <strong>{filteredAssignments.length.toLocaleString('vi-VN')}</strong> hồ sơ ứng tuyển
            </span>
          </div>

          {/* Thống kê nhanh kết quả lọc */}
          <div className="flex items-center gap-3 text-xs font-medium">
            <span className="text-slate-600">
              Đỗ PV: <strong className="text-blue-600 font-bold">{quickFilterSummary.passed.toLocaleString('vi-VN')}</strong>
            </span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600">
              Đạt 10 công: <strong className="text-emerald-600 font-bold">{quickFilterSummary.working.toLocaleString('vi-VN')}</strong>
            </span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600">
              Tỷ lệ giữ chân: <strong className="text-indigo-600 font-bold">{quickFilterSummary.rate}%</strong>
            </span>
          </div>
        </div>
      </div>

      {/* =========================================================================
          KHỐI 1: THẺ ĐIỂM TỪNG TEAM (100% DỮ LIỆU THỰC)
          ========================================================================= */}
      <div>
        <div className="mb-3">
          <h2 className="text-lg font-bold text-slate-900">Thẻ điểm từng team</h2>
          <p className="text-xs text-slate-500">
            Đặt các team cạnh nhau một cách công bằng: tính năng suất bình quân trên đầu người tuyển vì quy mô quân số khác nhau.
          </p>
        </div>

        {teamCards.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {teamCards.map((team) => (
              <div
                key={team.name}
                className={`bg-white rounded-2xl p-4 border transition-all duration-200 relative shadow-xs ${
                  team.isTop
                    ? 'border-purple-400 ring-2 ring-purple-100'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-sm">
                      {team.id}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm leading-tight">{team.name}</h3>
                      <p className="text-[11px] text-slate-500">{team.recruitersCount} người tuyển</p>
                    </div>
                  </div>

                  {team.isTop && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200">
                      Năng suất #1
                    </span>
                  )}
                </div>

                <div className="space-y-2 text-xs divide-y divide-slate-100">
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-slate-600">Tổng lượt đỗ:</span>
                    <span className="font-bold text-slate-900">{team.passed.toLocaleString('vi-VN')}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1.5">
                    <span className="text-slate-600">Đạt &gt;= 10 công:</span>
                    <span className="font-bold text-emerald-700">{team.retained10.toLocaleString('vi-VN')}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1.5">
                    <span className="text-slate-600">Tỷ lệ giữ chân 10 công:</span>
                    <span className="font-bold text-slate-900">{team.retentionRate}%</span>
                  </div>
                  <div className="flex items-center justify-between pt-1.5">
                    <span className="text-slate-600">Rớt trước xưởng:</span>
                    <span className="text-slate-700">{team.failRate}%</span>
                  </div>
                  <div className="flex items-center justify-between pt-1.5">
                    <span className="text-slate-600">Bỏ xưởng:</span>
                    <span className="text-slate-700">{team.abandonRate}%</span>
                  </div>
                  <div className="flex items-center justify-between pt-1.5">
                    <span className="text-slate-600">Nghỉ trước 10 công:</span>
                    <span className="text-slate-700">{team.quitBefore10Rate}%</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      ĐẠT/NGƯỜI TUYỂN
                    </div>
                    <div className="text-xl font-extrabold text-blue-600 mt-0.5">
                      {team.perRecruiter}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      ĐÓNG GÓP
                    </div>
                    <div className="text-xl font-extrabold text-slate-900 mt-0.5">
                      {team.contribution}%
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Card className="py-8 text-center border-slate-200">
            <Empty description="Chưa có dữ liệu Team nào trong bộ lọc này" />
          </Card>
        )}
      </div>

      {/* =========================================================================
          KHỐI 2: ĐÁNH GIÁ THỰC HIỆN KPI & TIẾN ĐỘ THEO CỘT / VÒNG TRÒN
          ========================================================================= */}
      <Card className="shadow-xs border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Đánh giá thực hiện KPI &amp; Tiến độ giữ chân
            </h2>
            <p className="text-xs text-slate-500">
              Kết hợp đo lường tỷ lệ hoàn thành KPI (Vòng tròn) và so sánh trực quan theo cột giữa các Nhà máy / Tháng.
            </p>
          </div>

          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setKpiViewMode('FACTORY')}
              className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                kpiViewMode === 'FACTORY' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📊 Cột: Theo Nhà máy tiếp nhận
            </button>
            <button
              type="button"
              onClick={() => setKpiViewMode('MONTH')}
              className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                kpiViewMode === 'MONTH' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📅 Cột: Theo Tháng phỏng vấn
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* CỘT TRÁI (4/12): VÒNG TRÒN ĐO LƯỜNG TIẾN ĐỘ KPI (DONUT METER GAUGE) */}
          <div className="lg:col-span-4 bg-slate-50/80 rounded-2xl p-5 border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Tỷ lệ đạt 10 công toàn kỳ
                </span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Chuẩn: &ge; 80%
                </span>
              </div>

              {/* Vòng tròn Donut SVG */}
              <div className="relative w-40 h-40 mx-auto my-3 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
                  {/* Vòng tròn nền mờ */}
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    stroke="#e2e8f0"
                    strokeWidth="10"
                    fill="transparent"
                  />
                  {/* Phân đoạn đạt 10 công */}
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    stroke="#10b981"
                    strokeWidth="10"
                    strokeDasharray={`${(overallKpi.retentionRate / 100) * 238.76} 238.76`}
                    strokeLinecap="round"
                    fill="transparent"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <div className="text-3xl font-extrabold text-slate-900 leading-none">
                    {overallKpi.retentionRate}%
                  </div>
                  <div className="text-[11px] font-semibold text-emerald-700 mt-1">
                    Đạt 10 công
                  </div>
                </div>
              </div>
            </div>

            {/* 4 Thống kê mini bên dưới vòng tròn */}
            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-200/80 text-xs">
              <div className="p-2 rounded-lg bg-white border border-slate-200">
                <div className="text-[10px] text-slate-500">Tổng đỗ PV</div>
                <div className="text-sm font-extrabold text-blue-700">{overallKpi.passed.toLocaleString('vi-VN')}</div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-slate-200">
                <div className="text-[10px] text-slate-500">Đạt &ge; 10 công</div>
                <div className="text-sm font-extrabold text-emerald-700">{overallKpi.retained10.toLocaleString('vi-VN')}</div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-slate-200">
                <div className="text-[10px] text-slate-500">Nghỉ &lt; 10 ngày</div>
                <div className="text-sm font-extrabold text-amber-600">{overallKpi.quit10.toLocaleString('vi-VN')}</div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-slate-200">
                <div className="text-[10px] text-slate-500">Bỏ xưởng / Rớt</div>
                <div className="text-sm font-extrabold text-rose-600">{(overallKpi.abandon + overallKpi.failed).toLocaleString('vi-VN')}</div>
              </div>
            </div>
          </div>

          {/* CỘT PHẢI (8/12): BIỂU ĐỒ CỘT KÉP TRỰC QUAN (GROUPED COLUMN BAR CHART) */}
          <div className="lg:col-span-8 flex flex-col justify-between">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="text-xs text-slate-500">
                {kpiViewMode === 'FACTORY'
                  ? 'So sánh số lượng Đạt 10 công vs Nghỉ sớm giữa các Nhà máy lớn tiếp nhận lao động'
                  : 'So sánh diễn biến tăng trưởng qua các tháng trong dữ liệu'}
              </div>

              <div className="flex items-center gap-4 text-xs font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-emerald-500" /> Đạt &ge; 10 công
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-amber-400" /> Nghỉ &lt; 10 ngày
                </span>
              </div>
            </div>

            {/* Vùng vẽ các cột (Column Bars) */}
            {(() => {
              const activeList = kpiViewMode === 'FACTORY' ? factoryChartData : monthlyChartData;
              if (!activeList.length) {
                return (
                  <div className="h-64 flex items-center justify-center border border-dashed border-slate-200 rounded-xl">
                    <Empty description="Chưa có dữ liệu phù hợp để vẽ biểu đồ cột" />
                  </div>
                );
              }

              const maxCol = Math.max(1, ...activeList.map(item => item.passed));

              return (
                <div className="space-y-2">
                  <div className="h-64 flex items-end gap-3 sm:gap-6 pt-8 pb-3 px-2 border-b border-slate-200 overflow-x-auto">
                    {activeList.map(item => {
                      const retH = Math.max(6, Math.round((item.retained10 / maxCol) * 190));
                      const quitH = item.quit10 > 0 ? Math.max(4, Math.round((item.quit10 / maxCol) * 190)) : 0;
                      const isHovered = hoveredBarItem?.name === item.name;

                      return (
                        <div
                          key={item.name}
                          onMouseEnter={() => setHoveredBarItem(item)}
                          onMouseLeave={() => setHoveredBarItem(null)}
                          className="flex-1 min-w-[65px] flex flex-col items-center justify-end h-full group cursor-pointer transition-transform"
                        >
                          {/* Nhãn % và số lượng trên đầu cột */}
                          <div className="text-center mb-1.5">
                            <span className="inline-block px-1.5 py-0.2 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-extrabold text-[10px]">
                              {item.rate}%
                            </span>
                            <div className="text-[10px] font-bold text-slate-700 mt-0.5">
                              {item.passed.toLocaleString('vi-VN')}
                            </div>
                          </div>

                          {/* 2 Cột song song: Cột xanh (Đạt 10 công) & Cột vàng (Nghỉ < 10) */}
                          <div className="w-full flex items-end justify-center gap-1">
                            <div
                              className={`w-6 sm:w-8 rounded-t-md bg-emerald-500 transition-all duration-300 ${
                                isHovered ? 'brightness-110 ring-2 ring-emerald-300' : ''
                              }`}
                              style={{ height: `${retH}px` }}
                              title={`${item.name} · Đạt 10 công: ${item.retained10} người`}
                            />
                            {item.quit10 > 0 && (
                              <div
                                className={`w-3.5 sm:w-5 rounded-t-md bg-amber-400 transition-all duration-300 ${
                                  isHovered ? 'brightness-110 ring-2 ring-amber-300' : ''
                                }`}
                                style={{ height: `${quitH}px` }}
                                title={`${item.name} · Nghỉ < 10 ngày: ${item.quit10} người`}
                              />
                            )}
                          </div>

                          {/* Tên danh mục bên dưới cột */}
                          <div
                            className={`text-[11px] font-bold text-center mt-2 truncate w-full ${
                              isHovered ? 'text-blue-700' : 'text-slate-600'
                            }`}
                            title={item.name}
                          >
                            {item.name}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Thanh chú thích nhanh khi trỏ chuột vào cột */}
                  <div className="min-h-[30px] flex items-center justify-between text-xs text-slate-600 px-2 pt-1">
                    {hoveredBarItem ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-bold text-slate-900">{hoveredBarItem.name}:</span>
                        <span>Đỗ: <b className="text-blue-700">{hoveredBarItem.passed}</b></span>
                        <span>Đạt 10 công: <b className="text-emerald-700">{hoveredBarItem.retained10} ({hoveredBarItem.rate}%)</b></span>
                        <span>Nghỉ &lt; 10: <b className="text-amber-700">{hoveredBarItem.quit10}</b></span>
                      </div>
                    ) : (
                      <span className="text-slate-400 italic">Di chuột vào từng cột để xem chi tiết số liệu theo từng đơn vị.</span>
                    )}
                    <span className="text-slate-400 text-[11px]">
                      Trục cao nhất: <b>{maxCol.toLocaleString('vi-VN')} đỗ</b>
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </Card>

      {/* =========================================================================
          KHỐI 3: NĂNG SUẤT & CHẤT LƯỢNG (100% DỮ LIỆU THỰC)
          ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-xs border-slate-200">
          <div className="mb-4">
            <h3 className="text-base font-bold text-slate-900">
              Năng suất: số đạt trên mỗi người tuyển
            </h3>
            <p className="text-xs text-slate-500">So sánh công bằng theo quy mô quân số</p>
          </div>

          {teamCards.length > 0 ? (
            <div className="space-y-4">
              {teamCards.map(team => {
                const maxPerRecruiter = Math.max(1, ...teamCards.map(t => t.perRecruiter));
                const widthPct = Math.round((team.perRecruiter / maxPerRecruiter) * 100);

                return (
                  <div key={team.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-slate-800">{team.name}</span>
                      <span className="text-blue-700 font-bold">{team.perRecruiter} người/NS</span>
                    </div>
                    <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-300"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty description="Chưa có dữ liệu năng suất theo team" />
          )}
        </Card>

        <Card className="shadow-xs border-slate-200">
          <div className="mb-4">
            <h3 className="text-base font-bold text-slate-900">
              Chất lượng: kết quả của 100 lượt đỗ
            </h3>
            <p className="text-xs text-slate-500">Đo lường mức độ rơi rụng thực tế tại các khâu</p>
          </div>

          {teamCards.length > 0 ? (
            <div className="space-y-4">
              {teamCards.map(team => {
                const totalSeg = Math.max(100, team.retentionRate + team.quitBefore10Rate + team.abandonRate + team.failRate);
                const retW = (team.retentionRate / totalSeg) * 100;
                const quitW = (team.quitBefore10Rate / totalSeg) * 100;
                const abanW = (team.abandonRate / totalSeg) * 100;
                const failW = Math.max(0, 100 - retW - quitW - abanW);

                return (
                  <div key={team.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-slate-800">{team.name} <span className="text-slate-400 font-normal">({team.passed.toLocaleString('vi-VN')} đỗ)</span></span>
                      <span className="text-emerald-700 font-bold">Trụ lại {team.retentionRate}% ({team.retained10.toLocaleString('vi-VN')} người)</span>
                    </div>
                    <div className="h-3.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${retW}%` }}
                        title={`Đạt >= 10 công: ${team.retentionRate}% (${team.retained10} người)`}
                      />
                      <div
                        className="h-full bg-amber-500 transition-all duration-300"
                        style={{ width: `${quitW}%` }}
                        title={`Nghỉ trước 10 công: ${team.quitBefore10Rate}%`}
                      />
                      <div
                        className="h-full bg-rose-500 transition-all duration-300"
                        style={{ width: `${abanW}%` }}
                        title={`Bỏ xưởng: ${team.abandonRate}%`}
                      />
                      <div
                        className="h-full bg-amber-300 transition-all duration-300"
                        style={{ width: `${failW}%` }}
                        title={`Rớt trước xưởng: ${team.failRate}%`}
                      />
                    </div>
                  </div>
                );
              })}

              <div className="mt-5 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"/> Đạt 10 công
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"/> Nghỉ trước 10
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500"/> Bỏ xưởng
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-300"/> Rớt trước
                </span>
              </div>
            </div>
          ) : (
            <Empty description="Chưa có dữ liệu chất lượng giữ chân theo team" />
          )}
        </Card>
      </div>

      {/* =========================================================================
          KHỐI 4: SỐ LƯỢNG VÀ CHẤT LƯỢNG CỦA TỪNG NGƯỜI TUYỂN (TRỰC QUAN, DỄ HIỂU)
          ========================================================================= */}
      <Card className="shadow-xs border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Số lượng và chất lượng của từng người tuyển
            </h2>
            <p className="text-xs text-slate-500">
              So sánh trực tiếp <b>Số lượng đỗ PV</b> và <b>Chất lượng giữ chân (&ge; 10 công)</b> của từng chuyên viên so với mức chuẩn công ty (<b>{medianPassed} đỗ · {medianRate}% đạt 10 công</b>). <b>Di chuột</b> để xem nhanh, <b>Bấm vào</b> để mở toàn bộ danh sách tuyển dụng.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-xs bg-emerald-500"/> Đạt &ge; 10 công
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-xs bg-amber-400"/> Nghỉ &lt; 10 ngày
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-xs bg-rose-400"/> Bỏ xưởng / Rớt
            </span>
          </div>
        </div>

        {recruiterLeaderboard.length > 0 ? (() => {
          const stars = recruiterLeaderboard.filter(r => r.passed >= medianPassed && r.passRateVal >= medianRate);
          const highQuality = recruiterLeaderboard.filter(r => r.passed < medianPassed && r.passRateVal >= medianRate);
          const highVolume = recruiterLeaderboard.filter(r => r.passed >= medianPassed && r.passRateVal < medianRate);
          const needSupport = recruiterLeaderboard.filter(r => r.passed < medianPassed && r.passRateVal < medianRate);

          const listByGroup =
            groupFilter === 'STAR' ? stars :
            groupFilter === 'QUALITY' ? highQuality :
            groupFilter === 'VOLUME' ? highVolume :
            groupFilter === 'SUPPORT' ? needSupport :
            recruiterLeaderboard;

          const visibleBars = showAllBars ? listByGroup : listByGroup.slice(0, 15);
          const maxTotal = Math.max(1, ...recruiterLeaderboard.map(r => r.total));

          return (
            <div className="space-y-4">
              {/* 4 THẺ PHÂN NHÓM NĂNG LỰC RÕ RÀNG (BẤM ĐỂ LỌC) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div
                  onClick={() => setGroupFilter('ALL')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    groupFilter === 'ALL'
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                      : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
                  }`}
                >
                  <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">Tất cả người tuyển</div>
                  <div className="text-2xl font-extrabold mt-1">{recruiterLeaderboard.length} <span className="text-xs font-normal">người</span></div>
                  <div className="text-[11px] opacity-75 mt-1">Chuẩn: {medianPassed} đỗ · {medianRate}% đạt</div>
                </div>

                <div
                  onClick={() => setGroupFilter('STAR')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    groupFilter === 'STAR'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs ring-2 ring-emerald-200'
                      : 'bg-emerald-50/70 hover:bg-emerald-100/70 border-emerald-200 text-emerald-950'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span>★ NGÔI SAO (TỐT CẢ 2)</span>
                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/20">{stars.length} người</span>
                  </div>
                  <div className="text-xs mt-1 font-medium opacity-90">
                    Đỗ &ge; {medianPassed} &amp; Giữ chân &ge; {medianRate}%
                  </div>
                  <div className="text-[11px] mt-1.5 truncate opacity-80">
                    Tiêu biểu: {stars.slice(0, 3).map(s => s.name).join(', ') || '—'}
                  </div>
                </div>

                <div
                  onClick={() => setGroupFilter('VOLUME')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    groupFilter === 'VOLUME'
                      ? 'bg-amber-500 text-white border-amber-500 shadow-xs ring-2 ring-amber-200'
                      : 'bg-amber-50/70 hover:bg-amber-100/70 border-amber-200 text-amber-950'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span>🚀 TUYỂN KHỎE (SL NHIỀU)</span>
                    <span className="px-1.5 py-0.2 rounded bg-amber-500/20">{highVolume.length} người</span>
                  </div>
                  <div className="text-xs mt-1 font-medium opacity-90">
                    Đỗ &ge; {medianPassed} · Giữ chân &lt; {medianRate}%
                  </div>
                  <div className="text-[11px] mt-1.5 truncate opacity-80">
                    Tiêu biểu: {highVolume.slice(0, 3).map(s => s.name).join(', ') || '—'}
                  </div>
                </div>

                <div
                  onClick={() => setGroupFilter('QUALITY')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    groupFilter === 'QUALITY'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs ring-2 ring-blue-200'
                      : 'bg-blue-50/70 hover:bg-blue-100/70 border-blue-200 text-blue-950'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span>🛡️ GIỮ CHÂN TỐT (CL CAO)</span>
                    <span className="px-1.5 py-0.2 rounded bg-blue-500/20">{highQuality.length} người</span>
                  </div>
                  <div className="text-xs mt-1 font-medium opacity-90">
                    Giữ chân &ge; {medianRate}% · Đỗ &lt; {medianPassed}
                  </div>
                  <div className="text-[11px] mt-1.5 truncate opacity-80">
                    Tiêu biểu: {highQuality.slice(0, 3).map(s => s.name).join(', ') || '—'}
                  </div>
                </div>

                <div
                  onClick={() => setGroupFilter('SUPPORT')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    groupFilter === 'SUPPORT'
                      ? 'bg-slate-700 text-white border-slate-700 shadow-xs ring-2 ring-slate-200'
                      : 'bg-slate-100/80 hover:bg-slate-200/70 border-slate-200 text-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span>⚠️ CẦN HỖ TRỢ THÊM</span>
                    <span className="px-1.5 py-0.2 rounded bg-slate-500/20">{needSupport.length} người</span>
                  </div>
                  <div className="text-xs mt-1 font-medium opacity-90">
                    Đỗ &lt; {medianPassed} &amp; Giữ chân &lt; {medianRate}%
                  </div>
                  <div className="text-[11px] mt-1.5 truncate opacity-80">
                    Tiêu biểu: {needSupport.slice(0, 3).map(s => s.name).join(', ') || '—'}
                  </div>
                </div>
              </div>

              {/* THANH TÓM TẮT NHANH KHI TRỎ CHUỘT VÀO BẤT KỲ NGƯỜI TUYỂN NÀO */}
              <div className="min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs">
                {hoveredRecruiter ? (
                  <>
                    <div className="flex items-center gap-2.5">
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 font-bold text-emerald-300 border border-emerald-500/30">
                        Hạng #{hoveredRecruiter.rank}
                      </span>
                      <span className="font-bold text-sm text-white">{hoveredRecruiter.name}</span>
                      <span className="text-slate-400">({hoveredRecruiter.team})</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <span>Tổng ứng tuyển: <b className="text-white">{hoveredRecruiter.total} người</b></span>
                      <span>Đỗ PV: <b className="text-sky-300">{hoveredRecruiter.passed} người</b> ({hoveredRecruiter.passedPerDay} người/ngày)</span>
                      <span>Đạt &ge; 10 công: <b className="text-emerald-400">{hoveredRecruiter.retained10} người ({hoveredRecruiter.passRate})</b></span>
                      <span>Nghỉ &lt; 10 ngày: <b className="text-amber-300">{hoveredRecruiter.quit10Count} người ({hoveredRecruiter.quitBefore10})</b></span>
                      <span>Bỏ xưởng: <b className="text-rose-300">{hoveredRecruiter.abandonedCount} người ({hoveredRecruiter.abandon})</b></span>
                      <span className="text-emerald-300 font-bold underline">🖱️ Bấm vào dòng để xem toàn bộ danh sách &rarr;</span>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-300 flex items-center justify-between w-full">
                    <span>💡 <b>Trỏ chuột</b> vào từng thanh người tuyển bên dưới để xem nhanh chỉ số · <b>Bấm chuột vào</b> để mở danh sách toàn bộ người lao động của người đó.</span>
                    <span className="text-slate-400 hidden sm:inline">Đang hiển thị: <b className="text-white">{visibleBars.length} / {listByGroup.length}</b> người tuyển</span>
                  </div>
                )}
              </div>

              {/* BIỂU ĐỒ THANH CHỒNG TRỰC QUAN TỪNG NGƯỜI TUYỂN */}
              <div className="border border-slate-200 rounded-xl bg-white divide-y divide-slate-100">
                <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-slate-50 text-[11px] font-bold text-slate-600 rounded-t-xl">
                  <div className="col-span-4 sm:col-span-3">NGƯỜI TUYỂN &amp; PHÂN NHÓM</div>
                  <div className="col-span-5 sm:col-span-6">BIỂU ĐỒ SỐ LƯỢNG &amp; CHẤT LƯỢNG (XANH: ĐẠT 10 CÔNG · VÀNG: NGHỈ &lt;10 · ĐỎ: BỎ/RỚT)</div>
                  <div className="col-span-3 text-right">KẾT QUẢ &amp; HỒ SƠ</div>
                </div>

                <div className="max-h-[460px] overflow-y-auto divide-y divide-slate-100">
                  {visibleBars.map((rec) => {
                    const isStar = rec.passed >= medianPassed && rec.passRateVal >= medianRate;
                    const isHighQuality = rec.passed < medianPassed && rec.passRateVal >= medianRate;
                    const isHighVolume = rec.passed >= medianPassed && rec.passRateVal < medianRate;

                    const badge = isStar
                      ? { label: '★ Ngôi sao', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
                      : isHighVolume
                      ? { label: '🚀 Tuyển khỏe', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
                      : isHighQuality
                      ? { label: '🛡️ Giữ chân tốt', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
                      : { label: '⚠️ Cần hỗ trợ', cls: 'bg-slate-100 text-slate-600 border-slate-200' };

                    const otherCount = Math.max(0, rec.total - rec.retained10 - rec.quit10Count);
                    const retWidth = (rec.retained10 / maxTotal) * 100;
                    const quitWidth = (rec.quit10Count / maxTotal) * 100;
                    const otherWidth = (otherCount / maxTotal) * 100;

                    return (
                      <div
                        key={rec.name}
                        onMouseEnter={() => setHoveredRecruiter(rec)}
                        onClick={() => {
                          setSelectedRecruiter(rec);
                          setModalSearch('');
                          setModalStatusFilter('ALL');
                        }}
                        className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-blue-50/60 cursor-pointer transition-colors"
                      >
                        {/* Cột 1: Tên & Nhóm */}
                        <div className="col-span-4 sm:col-span-3 flex items-center gap-2 min-w-0">
                          <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 font-bold text-[11px] flex items-center justify-center shrink-0">
                            {rec.rank}
                          </span>
                          <div className="min-w-0">
                            <div className="font-bold text-xs text-blue-700 truncate hover:underline">{rec.name}</div>
                            <span className={`inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold border ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </div>
                        </div>

                        {/* Cột 2: Thanh biểu đồ 3 màu trực quan */}
                        <div className="col-span-5 sm:col-span-6 space-y-1">
                          <div className="h-5 w-full bg-slate-100 rounded-md overflow-hidden flex items-center">
                            {rec.retained10 > 0 && (
                              <div
                                className="h-full bg-emerald-500 flex items-center justify-center text-[10px] font-bold text-white overflow-hidden"
                                style={{ width: `${Math.max(retWidth, 2)}%` }}
                                title={`Đạt >= 10 công: ${rec.retained10} người (${rec.passRate})`}
                              >
                                {retWidth > 8 ? rec.retained10 : ''}
                              </div>
                            )}
                            {rec.quit10Count > 0 && (
                              <div
                                className="h-full bg-amber-400 flex items-center justify-center text-[10px] font-bold text-slate-900 overflow-hidden"
                                style={{ width: `${Math.max(quitWidth, 1.5)}%` }}
                                title={`Nghỉ < 10 ngày: ${rec.quit10Count} người (${rec.quitBefore10})`}
                              >
                                {quitWidth > 6 ? rec.quit10Count : ''}
                              </div>
                            )}
                            {otherCount > 0 && (
                              <div
                                className="h-full bg-rose-400 flex items-center justify-center text-[10px] font-bold text-white overflow-hidden"
                                style={{ width: `${Math.max(otherWidth, 1.5)}%` }}
                                title={`Bỏ xưởng / Rớt: ${otherCount} người`}
                              >
                                {otherWidth > 6 ? otherCount : ''}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                            <span className="text-emerald-700 font-semibold">Đạt 10 công: <b>{rec.retained10}</b> ({rec.passRate})</span>
                            <span>Nghỉ &lt;10: <b className="text-amber-700">{rec.quit10Count}</b></span>
                            <span>Bỏ xưởng: <b className="text-rose-600">{rec.abandonedCount}</b></span>
                          </div>
                        </div>

                        {/* Cột 3: Tổng đỗ & Nút xem chi tiết */}
                        <div className="col-span-3 flex items-center justify-end gap-2.5 text-right">
                          <div>
                            <div className="text-xs font-extrabold text-slate-900">{rec.passed} đỗ PV</div>
                            <div className="text-[11px] font-bold text-emerald-700">Đạt {rec.passRate}</div>
                          </div>
                          <span className="hidden sm:inline-flex px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] shrink-0">
                            Chi tiết ({rec.total})
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {listByGroup.length > 15 && (
                  <div className="p-2.5 bg-slate-50 text-center rounded-b-xl">
                    <button
                      type="button"
                      onClick={() => setShowAllBars(prev => !prev)}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 underline cursor-pointer"
                    >
                      {showAllBars
                        ? 'Thu gọn (Chỉ hiện Top 15 người tuyển dẫn đầu)'
                        : `Xem toàn bộ ${listByGroup.length} người tuyển trong nhóm này`}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })() : (
          <Empty description="Chưa có dữ liệu chuyên viên tuyển dụng để phân tích" />
        )}
      </Card>

      {/* =========================================================================
          KHỐI 6: HAI CARD ĐỐI SOÁT CHÂN TRANG (100% DỮ LIỆU THỰC)
          ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-xs border-slate-200">
          <div className="mb-4">
            <h3 className="text-base font-bold text-slate-900">
              Công nhân giới thiệu so với tuyển trực tiếp
            </h3>
            <p className="text-xs text-slate-500">
              Đánh giá tính hiệu quả của chính sách hoa hồng giới thiệu
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <span className="font-semibold text-slate-800">Tuyển trực tiếp:</span>
              <div className="space-x-3">
                <span className="font-bold text-slate-900">{sourceComparison.directPassed.toLocaleString('vi-VN')} đỗ</span>
                <span className="font-bold text-emerald-700">Đạt 10 công {sourceComparison.directRate}%</span>
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <span className="font-semibold text-slate-800">Lao động tự giới thiệu:</span>
              <div className="space-x-3">
                <span className="font-bold text-slate-900">{sourceComparison.referralPassed.toLocaleString('vi-VN')} đỗ</span>
                <span className="font-bold text-emerald-700">Đạt 10 công {sourceComparison.referralRate}%</span>
              </div>
            </div>
          </div>

          <p className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400 italic">
            Tỷ lệ quan sát = số đạt 10 công / số đỗ của từng nguồn; phân loại trực tiếp theo trường nguồn hồ sơ trong CSDL.
          </p>
        </Card>

        <Card className="shadow-xs border-slate-200">
          <div className="mb-4">
            <h3 className="text-base font-bold text-slate-900">Người quay lại (Tái tuyển)</h3>
            <p className="text-xs text-slate-500">
              Theo dõi lực lượng công nhân cũ vào làm lại tại các nhà máy
            </p>
          </div>

          <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-200/80 flex items-center justify-around text-center">
            <div>
              <div className="text-[11px] font-semibold text-slate-500 mb-1">
                Tổng lượt tái tuyển
              </div>
              <div className="text-lg font-bold text-slate-900">
                {data?.recruitment?.summary?.returning ? `${data.recruitment.summary.returning.toLocaleString('vi-VN')} lượt` : '0 lượt'}
              </div>
            </div>

            <div className="h-10 w-px bg-slate-200" />

            <div>
              <div className="text-[11px] font-semibold text-slate-500 mb-1">
                Tỷ lệ qua 10 công
              </div>
              <div className="text-lg font-bold text-emerald-700">
                {pct(data?.recruitment?.summary?.returnRate)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* =========================================================================
          KHỐI 7: CHÂN DUNG NGƯỜI LAO ĐỘNG (100% DỮ LIỆU THỰC)
          ========================================================================= */}
      <div className="pt-4 border-t-2 border-slate-200">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-600"/>
            Chân Dung Người Lao Động (Nhân Khẩu Học)
          </h2>
          <p className="text-xs text-slate-500">
            Xem cơ cấu nguồn lao động của toàn bộ công ty hoặc lọc riêng để xem thế mạnh nguồn của từng Team / Chuyên viên.
          </p>
        </div>

        <Card className="shadow-xs border-slate-200 bg-slate-50/70 mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Target className="w-4 h-4 text-purple-600"/>
                Chọn Phạm Vi Xem Chân Dung Lao Động
              </h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Xem cơ cấu nguồn lao động của <b>toàn bộ công ty</b> hoặc lọc riêng để xem thế mạnh nguồn của từng <b>Team</b> / <b>Chuyên viên</b>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Select
                className="w-36"
                value={demoScopeType}
                onChange={(val) => {
                  setDemoScopeType(val);
                  setDemoScopeValue('');
                }}
                options={[
                  { value: 'ALL', label: 'Toàn bộ công ty' },
                  { value: 'TEAM', label: 'Theo Team' },
                  { value: 'RECRUITER', label: 'Theo Chuyên viên' },
                ]}
              />

              {demoScopeType === 'TEAM' && (
                <Select
                  className="w-48"
                  placeholder="Chọn Team cần xem..."
                  value={demoScopeValue || undefined}
                  onChange={setDemoScopeValue}
                  options={catalogTeams.map(t => ({ value: t.name, label: t.name }))}
                />
              )}

              {demoScopeType === 'RECRUITER' && (
                <Select
                  className="w-52"
                  placeholder="Chọn Chuyên viên..."
                  showSearch
                  value={demoScopeValue || undefined}
                  onChange={setDemoScopeValue}
                  options={recruiterLeaderboard.map(r => ({ value: r.name, label: r.name }))}
                />
              )}
            </div>
          </div>
        </Card>

        {demoData && demoData.people > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 1. Giới tính */}
            <Card
              title={
                <span className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600"/>
                  Cơ Cấu Giới Tính
                </span>
              }
              className="shadow-xs border-slate-200"
            >
              <div className="space-y-4">
                {(demoData.genders || []).map((g: any) => {
                  const percent = demoData.people ? Math.round((g.count / demoData.people) * 100) : 0;
                  const isMale = g.name.toLowerCase().includes('nam');
                  return (
                    <div key={g.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className={isMale ? 'text-blue-700' : 'text-pink-600'}>{g.name}</span>
                        <span className="text-slate-600">
                          {g.count.toLocaleString('vi-VN')} người <b>({percent}%)</b>
                        </span>
                      </div>
                      <Progress
                        percent={percent}
                        strokeColor={isMale ? '#2563eb' : '#ec4899'}
                        trailColor="#f1f5f9"
                        showInfo={false}
                      />
                    </div>
                  );
                })}
                <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 flex justify-between">
                  <span>Tổng số ứng viên trong mẫu:</span>
                  <b className="text-slate-800">{demoData.people.toLocaleString('vi-VN')} người</b>
                </div>
              </div>
            </Card>

            {/* 2. Độ tuổi */}
            <Card
              title={
                <span className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-emerald-600"/>
                  Phân Bố Nhóm Tuổi
                </span>
              }
              className="shadow-xs border-slate-200"
            >
              <div className="space-y-4">
                {(demoData.ages || []).map((a: any) => {
                  const percent = demoData.people ? Math.round((a.count / demoData.people) * 100) : 0;
                  return (
                    <div key={a.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="text-slate-800">{a.name}</span>
                        <span className="text-slate-600">
                          {a.count.toLocaleString('vi-VN')} người <b>({percent}%)</b>
                        </span>
                      </div>
                      <Progress
                        percent={percent}
                        strokeColor="#10b981"
                        trailColor="#f1f5f9"
                        showInfo={false}
                      />
                    </div>
                  );
                })}
                <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                  Tuổi được tính tại thời điểm phỏng vấn.
                </div>
              </div>
            </Card>

            {/* 3. Địa bàn / Tỉnh thành quê quán */}
            <Card
              title={
                <span className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Building className="w-4 h-4 text-amber-600"/>
                  Địa Bàn / Tỉnh Thành (Top Quê Quán)
                </span>
              }
              className="shadow-xs border-slate-200"
            >
              <div className="space-y-3.5 max-h-[380px] overflow-y-auto pr-1">
                {[...(demoData.provinces || [])]
                  .sort((a, b) => b.count - a.count)
                  .map((p: any, idx: number) => {
                    const percent = demoData.people ? Math.round((p.count / demoData.people) * 100) : 0;
                    return (
                      <div key={p.name} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-medium">
                          <span className="truncate max-w-[160px] text-slate-800 font-semibold">
                            <span className="text-slate-400 mr-1.5 font-normal">#{idx + 1}</span>
                            {p.name}
                          </span>
                          <span className="text-slate-600">
                            {p.count.toLocaleString('vi-VN')} <b>({percent}%)</b>
                          </span>
                        </div>
                        <Progress
                          percent={percent}
                          strokeColor="#f59e0b"
                          trailColor="#f1f5f9"
                          showInfo={false}
                          size="small"
                        />
                      </div>
                    );
                  })}
              </div>
            </Card>
          </div>
        ) : (
          <Card className="py-12 text-center border-slate-200">
            <Empty description="Chưa có dữ liệu chân dung người lao động trong bộ lọc này" />
          </Card>
        )}
      </div>

      {/* =========================================================================
          MODAL CHI TIẾT TOÀN BỘ THÔNG TIN TUYỂN DỤNG CỦA CHUYÊN VIÊN KHI BẤM VÀO
          ========================================================================= */}
      <Modal
        open={!!selectedRecruiter}
        onCancel={() => setSelectedRecruiter(null)}
        footer={null}
        width={1140}
        title={
          selectedRecruiter ? (
            <div className="flex flex-wrap items-center justify-between gap-3 pr-6">
              <div className="flex items-center gap-2.5">
                <span className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold">
                  Hạng #{selectedRecruiter.rank}
                </span>
                <div>
                  <div className="text-base font-bold text-slate-900">
                    Hồ sơ năng lực &amp; Danh sách tuyển dụng: {selectedRecruiter.name}
                  </div>
                  <div className="text-xs font-normal text-slate-500">
                    Đội nhóm: <b>{selectedRecruiter.team}</b> · Tổng số ngày có ứng viên đỗ: <b>{selectedRecruiter.activeDays} ngày</b> ({selectedRecruiter.passedPerDay} đỗ/ngày)
                  </div>
                </div>
              </div>
            </div>
          ) : null
        }
      >
        {selectedRecruiter && (() => {
          const allAsgs: any[] = selectedRecruiter.assignments || [];

          // Thống kê theo nhà máy của chuyên viên này
          const byFactory = new Map<string, { total: number; passed: number; retained10: number }>();
          const byMonth = new Map<string, { total: number; passed: number; retained10: number }>();

          for (const a of allAsgs) {
            const fac = a.interviewFactory || a.workingFactory || 'Chưa rõ';
            const fCur = byFactory.get(fac) || { total: 0, passed: 0, retained10: 0 };
            fCur.total++;
            if (isPassed(a)) fCur.passed++;
            if (isWorking(a)) fCur.retained10++;
            byFactory.set(fac, fCur);

            const mo = monthOf(a.interviewDate);
            const mCur = byMonth.get(mo) || { total: 0, passed: 0, retained10: 0 };
            mCur.total++;
            if (isPassed(a)) mCur.passed++;
            if (isWorking(a)) mCur.retained10++;
            byMonth.set(mo, mCur);
          }

          // Lọc danh sách hồ sơ theo ô tìm kiếm và trạng thái
          const filteredAsgs = allAsgs.filter(a => {
            if (modalStatusFilter === 'RETAINED10' && !isWorking(a)) return false;
            if (modalStatusFilter === 'QUIT10' && !isQuitBefore10(a)) return false;
            if (modalStatusFilter === 'ABANDON' && !isAbandon(a)) return false;
            if (modalStatusFilter === 'WORKING_NOW') {
              const s = String(a.status || '').trim().toLowerCase();
              if (!['lv', 'đang làm việc', 'chuyển chính thức', 'đang lv'].includes(s)) return false;
            }
            if (modalSearch.trim()) {
              const q = modalSearch.trim().toLowerCase();
              const hay = [
                a.worker?.fullName,
                a.worker?.idCard,
                a.employeeCode,
                a.worker?.code,
                a.worker?.phone,
                a.interviewFactory,
                a.workingFactory,
                a.worker?.province,
                a.status
              ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
              if (!hay.includes(q)) return false;
            }
            return true;
          });

          return (
            <div className="space-y-5 pt-2">
              {/* 1. 6 Thẻ chỉ số tổng quan của người tuyển */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] font-semibold text-slate-500">Tổng lượt ứng tuyển</div>
                  <div className="text-xl font-extrabold text-slate-900 mt-0.5">{selectedRecruiter.total}</div>
                  <div className="text-[10px] text-slate-400">Toàn bộ hồ sơ</div>
                </div>
                <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200">
                  <div className="text-[11px] font-semibold text-blue-700">Tổng đỗ phỏng vấn</div>
                  <div className="text-xl font-extrabold text-blue-700 mt-0.5">{selectedRecruiter.passed}</div>
                  <div className="text-[10px] text-blue-600">TB {selectedRecruiter.passedPerDay} người/ngày</div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200">
                  <div className="text-[11px] font-semibold text-emerald-700">Đạt &ge; 10 công</div>
                  <div className="text-xl font-extrabold text-emerald-700 mt-0.5">{selectedRecruiter.retained10}</div>
                  <div className="text-[10px] font-bold text-emerald-600">Tỷ lệ đạt: {selectedRecruiter.passRate}</div>
                </div>
                <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200">
                  <div className="text-[11px] font-semibold text-amber-800">Nghỉ &lt; 10 ngày</div>
                  <div className="text-xl font-extrabold text-amber-700 mt-0.5">{selectedRecruiter.quit10Count}</div>
                  <div className="text-[10px] text-amber-700">Chiếm {selectedRecruiter.quitBefore10} số đỗ</div>
                </div>
                <div className="p-3 rounded-xl bg-rose-50/70 border border-rose-200">
                  <div className="text-[11px] font-semibold text-rose-700">Bỏ xưởng / Bỏ ĐT</div>
                  <div className="text-xl font-extrabold text-rose-600 mt-0.5">{selectedRecruiter.abandonedCount}</div>
                  <div className="text-[10px] text-rose-600">Chiếm {selectedRecruiter.abandon} tổng HS</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] font-semibold text-slate-600">Rớt trước xưởng</div>
                  <div className="text-xl font-extrabold text-slate-700 mt-0.5">{selectedRecruiter.failedCount}</div>
                  <div className="text-[10px] text-slate-500">Chiếm {selectedRecruiter.dropBefore} tổng HS</div>
                </div>
              </div>

              {/* 2. Phân bổ theo Nhà máy & Theo Tháng */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200">
                  <div className="text-xs font-bold text-slate-800 mb-2">
                    🏭 Phân bổ theo Nhà máy phỏng vấn
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(byFactory.entries())
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([fac, st]) => {
                        const r = st.passed > 0 ? Math.round((st.retained10 / st.passed) * 100) : 0;
                        return (
                          <span
                            key={fac}
                            className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 shadow-2xs"
                          >
                            <b>{fac}</b>: {st.passed} đỗ · <span className="text-emerald-700 font-semibold">{st.retained10} đạt ({r}%)</span>
                          </span>
                        );
                      })}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200">
                  <div className="text-xs font-bold text-slate-800 mb-2">
                    📅 Kết quả theo từng tháng phỏng vấn
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(byMonth.entries())
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([mo, st]) => {
                        const r = st.passed > 0 ? Math.round((st.retained10 / st.passed) * 100) : 0;
                        return (
                          <span
                            key={mo}
                            className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 shadow-2xs"
                          >
                            <b>{mo}</b>: {st.passed} đỗ · <span className="text-emerald-700 font-semibold">{st.retained10} đạt ({r}%)</span>
                          </span>
                        );
                      })}
                  </div>
                </div>
              </div>

              {/* 3. Bộ lọc & Bảng danh sách toàn bộ người lao động */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      { key: 'ALL', label: `Tất cả (${allAsgs.length})` },
                      { key: 'RETAINED10', label: `Đạt >= 10 công (${selectedRecruiter.retained10})` },
                      { key: 'QUIT10', label: `Nghỉ < 10 ngày (${selectedRecruiter.quit10Count})` },
                      { key: 'ABANDON', label: `Bỏ xưởng (${selectedRecruiter.abandonedCount})` },
                      { key: 'WORKING_NOW', label: 'Đang làm việc (LV)' },
                    ].map(tab => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setModalStatusFilter(tab.key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                          modalStatusFilter === tab.key
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <Input
                    placeholder="Tìm tên NLĐ, CCCD, Mã NV, SĐT, nhà máy..."
                    prefix={<Search className="w-3.5 h-3.5 text-slate-400" />}
                    value={modalSearch}
                    onChange={e => setModalSearch(e.target.value)}
                    allowClear
                    className="w-full sm:w-72"
                  />
                </div>

                <Table
                  size="small"
                  rowKey={(r: any) => r.id}
                  dataSource={filteredAsgs}
                  pagination={{ pageSize: 12, showSizeChanger: true, showTotal: (t) => `Tổng ${t} hồ sơ` }}
                  scroll={{ x: 980 }}
                  columns={[
                    {
                      title: 'Mã NV',
                      key: 'code',
                      width: 95,
                      render: (_: any, r: any) => (
                        <span className="font-mono font-bold text-xs text-slate-800">
                          {r.employeeCode || r.worker?.code || '—'}
                        </span>
                      )
                    },
                    {
                      title: 'Họ và tên NLĐ',
                      key: 'fullName',
                      width: 170,
                      render: (_: any, r: any) => (
                        <div>
                          <div className="font-bold text-slate-900 text-xs">{r.worker?.fullName || '—'}</div>
                          <div className="text-[11px] text-slate-500">
                            {r.worker?.gender || '—'} · {r.worker?.dob || '—'}
                          </div>
                        </div>
                      )
                    },
                    {
                      title: 'CCCD & SĐT',
                      key: 'idCard',
                      width: 135,
                      render: (_: any, r: any) => (
                        <div className="text-xs">
                          <div className="font-mono text-slate-800">{r.worker?.idCard || '—'}</div>
                          <div className="text-[11px] text-slate-500">{r.worker?.phone || '—'}</div>
                        </div>
                      )
                    },
                    {
                      title: 'Quê quán',
                      key: 'province',
                      width: 120,
                      render: (_: any, r: any) => (
                        <span className="text-xs text-slate-700 truncate block max-w-[115px]">
                          {r.worker?.province || r.worker?.address || '—'}
                        </span>
                      )
                    },
                    {
                      title: 'Nhà máy PV',
                      key: 'factory',
                      width: 110,
                      render: (_: any, r: any) => (
                        <span className="font-semibold text-xs text-blue-700">
                          {r.workingFactory || r.interviewFactory || '—'}
                        </span>
                      )
                    },
                    {
                      title: 'Ngày PV',
                      dataIndex: 'interviewDate',
                      key: 'interviewDate',
                      width: 95,
                      render: (v: string) => <span className="text-xs text-slate-700">{v || '—'}</span>
                    },
                    {
                      title: 'Ngày nghỉ (NH)',
                      dataIndex: 'leaveDate',
                      key: 'leaveDate',
                      width: 95,
                      render: (v: string) => <span className="text-xs text-slate-600">{v || '—'}</span>
                    },
                    {
                      title: 'Số ngày làm',
                      key: 'workDays',
                      width: 100,
                      align: 'center' as const,
                      render: (_: any, r: any) => {
                        const days = diffDays(r.startDate || r.interviewDate, r.leaveDate);
                        const s = String(r.status || '').trim().toLowerCase();
                        if (['lv', 'đang làm việc', 'chuyển chính thức', 'đang lv'].includes(s)) {
                          return <Tag color="green">Đang LV</Tag>;
                        }
                        if (days != null && days >= 0) {
                          return (
                            <span className={`font-bold text-xs ${days >= 10 ? 'text-emerald-700' : 'text-amber-600'}`}>
                              {days} ngày
                            </span>
                          );
                        }
                        if (r.confirmedWorkDays != null) {
                          return <span className="font-bold text-xs text-emerald-700">{r.confirmedWorkDays} công</span>;
                        }
                        return <span className="text-xs text-slate-400">—</span>;
                      }
                    },
                    {
                      title: 'Trạng thái',
                      dataIndex: 'status',
                      key: 'status',
                      width: 100,
                      render: (v: string) => <Tag>{v || '—'}</Tag>
                    },
                    {
                      title: 'Đánh giá KPI 10 công',
                      key: 'kpiEval',
                      width: 135,
                      render: (_: any, r: any) => {
                        if (isWorking(r)) return <Tag color="success">Đạt &ge; 10 công</Tag>;
                        if (isQuitBefore10(r)) return <Tag color="warning">Nghỉ &lt; 10 ngày</Tag>;
                        if (isAbandon(r)) return <Tag color="error">Bỏ xưởng</Tag>;
                        if (isFailed(r)) return <Tag color="default">Rớt PV</Tag>;
                        return <Tag>{r.status || 'Khác'}</Tag>;
                      }
                    }
                  ]}
                />
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
