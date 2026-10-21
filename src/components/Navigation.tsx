'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FileText,
  LayoutDashboard,
  Target,
  Users,
  UserCheck,
  Fingerprint,
  Truck,
  FileSpreadsheet,
  History,
  Coins,
  CreditCard,
  Award,
  TrendingUp,
  SlidersHorizontal,
  Layers,
  Search,
  Building2,
  ShieldAlert,
  Menu,
  X,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: any;
  badge?: string;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    group: 'BÁO CÁO & KPI',
    items: [
      { href: '/', label: 'Tổng quan Dashboard', icon: LayoutDashboard },
      { href: '/workers', label: 'Hồ sơ lao động', icon: FileText },
      { href: '/performance', label: 'Đánh giá & So sánh KPI', icon: TrendingUp },
      { href: '/orders', label: 'Đơn hàng & đợt tuyển', icon: Target },
      { href: '/duplicates', label: 'Cảnh báo trùng lặp', icon: ShieldAlert },
      { href: '/lookup', label: 'Tra cứu người LĐ', icon: Fingerprint },
    ],
  },
  {
    group: 'CHÍNH SÁCH & THƯỞNG',
    items: [
      { href: '/bonuses', label: 'Quản lí thưởng', icon: Coins },
      { href: '/rewards', label: 'Mốc thưởng / Đã trả', icon: Award },
      { href: '/bank-accounts', label: 'Tài chính & STK 2026', icon: CreditCard },
      { href: '/policies', label: 'Chính sách thưởng', icon: SlidersHorizontal },
    ],
  },
  {
    group: 'HỆ THỐNG & CÔNG CỤ',
    items: [
      { href: '/excel-tools', label: 'Bộ máy Excel Engine', icon: FileSpreadsheet },
      { href: '/catalogs', label: 'Danh mục cấu hình', icon: Layers },
      { href: '/audit', label: 'Lịch sử thay đổi', icon: History },
    ],
  },
];

const TAB_TITLES: Record<string, { title: string; subtitle?: string }> = {
  '/': { title: 'Tổng quan Dashboard', subtitle: 'Báo cáo tiến độ và công suất phễu tuyển dụng toàn công ty' },
  '/performance': { title: 'Đánh giá & So sánh KPI', subtitle: 'So sánh hiệu suất tuyển dụng theo Team & Chuyên viên và phân tích chân dung người lao động' },
  '/workers': { title: 'Hồ sơ lao động', subtitle: 'Kiểm tra hồ sơ và xuất dữ liệu đang lọc' },
  '/orders': { title: 'Đơn hàng & đợt tuyển', subtitle: 'Theo dõi tiến độ đơn hàng và chỉ tiêu theo từng nhà máy' },
  '/duplicates': { title: 'Cảnh báo trùng lặp', subtitle: 'Phát hiện ứng viên trùng CCCD, SĐT hoặc nghỉ việc quay lại' },
  '/lookup': { title: 'Tra cứu người LĐ', subtitle: 'Giải mã tự động và tra cứu hồ sơ cá nhân theo CCCD 12 số' },
  '/bonuses': { title: 'Quản lí thưởng', subtitle: 'Ghi nhận và xét duyệt 7 khoản thưởng theo chính sách' },
  '/rewards': { title: 'Mốc thưởng & Đã trả', subtitle: 'Tiến độ mốc công yêu cầu và ghi nhận chứng từ thanh toán' },
  '/bank-accounts': { title: 'Tài chính & STK 2026', subtitle: 'Đối chiếu số tài khoản ngân hàng và kiểm soát rủi ro lệch tên' },
  '/policies': { title: 'Chính sách thưởng', subtitle: 'Quy chế thưởng công nhân theo nhà máy và đơn hàng' },
  '/import-review': {title:'Phân luồng import',subtitle:'Cảnh báo dữ liệu và danh sách trùng chờ kiểm tra'},
  '/excel-tools': { title: 'Bộ máy Excel Engine', subtitle: 'Nhập xuất dữ liệu DS_TONG, lệnh chi ngân hàng và cảnh báo trùng' },
  '/catalogs': { title: 'Danh mục cấu hình', subtitle: 'Thiết lập danh mục nhà máy, team và trạng thái lao động' },
  '/audit': { title: 'Lịch sử thay đổi', subtitle: 'Nhật ký kiểm toán toàn bộ thao tác thêm, sửa, xóa, duyệt' },
};

export default function Navigation({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const [isOpenMobile, setIsOpenMobile] = useState(false);
  const [isOtherModulesOpen, setIsOtherModulesOpen] = useState(false);

  useEffect(() => {
    setIsOpenMobile(false);
  }, [pathname]);

  const meta = TAB_TITLES[pathname] || {
    title: 'Trang điều hành • Tuyển dụng & Thưởng',
    subtitle: 'Hệ thống Quản trị Lao động Tri Thức Việt 2026',
  };


  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Backdrop for mobile */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs md:hidden"
          onClick={() => setIsOpenMobile(false)}
        />
      )}

      {/* SIDEBAR BÊN TRÁI - PHONG CÁCH TRI THỨC VIỆT */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4">
          <div className="flex items-center gap-3">
            {/* TTV Red Badge Logo */}
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 font-bold text-white shadow-xs shrink-0">
              <span className="text-xs tracking-wider">TTV</span>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 truncate">Tri Thức Việt</div>
              <div className="text-[11px] text-slate-500 truncate">Trang điều hành • Quản lí</div>
            </div>
          </div>
          <button
            onClick={() => setIsOpenMobile(false)}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 md:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto px-3 py-4 text-xs font-medium text-slate-600">
          {navGroups.map((group) => {
            const visibleItems = group.items;

            if (visibleItems.length === 0) return null;

            return (
              <div key={group.group} className="mb-6">
                <div className="px-3 pb-2 text-[10px] font-bold tracking-wider text-slate-400 uppercase select-none">
                  {group.group}
                </div>
                <div className="space-y-1">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-blue-50 font-semibold text-blue-600'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        <Icon
                          className={`h-4 w-4 shrink-0 ${
                            isActive ? 'text-blue-600' : 'text-slate-400'
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Module khác (collapsible theo chuẩn bên Đánh giá) */}
          <div className="mb-4">
            <button
              onClick={() => setIsOtherModulesOpen(!isOtherModulesOpen)}
              className="flex w-full items-center justify-between px-3 py-2 text-[10px] font-bold tracking-wider text-slate-400 uppercase hover:text-slate-600"
            >
              <span>MODULE KHÁC</span>
              {isOtherModulesOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
            {isOtherModulesOpen && (
              <div className="mt-1 space-y-1 pl-2">
                <div className="flex items-center gap-2.5 rounded-md px-3 py-2 text-slate-400 hover:text-slate-500 cursor-not-allowed">
                  <FileText className="h-3.5 w-3.5" />
                  <span>Chấm công nhà máy</span>
                  <span className="ml-auto text-[9px] rounded bg-slate-100 px-1 py-0.5 text-slate-400">
                    GĐ 2
                  </span>
                </div>
                <div className="flex items-center gap-2.5 rounded-md px-3 py-2 text-slate-400 hover:text-slate-500 cursor-not-allowed">
                  <Truck className="h-3.5 w-3.5" />
                  <span>Logistics xe đưa đón</span>
                  <span className="ml-auto text-[9px] rounded bg-slate-100 px-1 py-0.5 text-slate-400">
                    GĐ 2
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer info chuẩn TTV */}
        <div className="border-t border-slate-100 p-3">
          <div className="rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-500">
            <div className="font-semibold text-slate-700">TTV Recruitment OS</div>
            <div className="text-[10px] text-slate-400">Phiên bản hiện đại hóa 2026</div>
          </div>
        </div>
      </aside>

      {/* NỘI DUNG CHÍNH (CONTENT AREA) */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* HEADER TRÊN CÙNG CHUẨN TTV (H-14) */}
        <header className="sticky top-0 z-30 flex flex-col border-b border-slate-200 bg-white/95 backdrop-blur-xs">
          <div className="flex h-14 items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setIsOpenMobile(true)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
                title="Mở menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="text-base font-bold text-slate-900 truncate">{meta.title}</h1>
              </div>
            </div>

            {/* Right side: Sync info & Profile */}
            <div className="flex items-center gap-3 text-xs shrink-0">
              {/* Nút Nhập dữ liệu thật (Excel/CSV) dẫn tới Excel Engine */}
              {pathname !== "/excel-tools" && <Link
                href="/excel-tools"
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs transition"
                title="Mở bộ máy xử lý và nạp file Excel"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Nhập Excel/CSV</span>
              </Link>}

              {/* Sync status */}
              <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 xl:flex">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
                <span className="text-slate-500">
                  Chế độ: <strong className="text-slate-700">Trực tuyến 2026</strong>
                </span>
                <span className="text-slate-300">•</span>
                <span className="font-medium text-emerald-600">Đã kết nối CSDL</span>
              </div>

              <span className="text-xs text-slate-500">Dùng trên máy này</span>
            </div>
          </div>
        </header>

        {/* MAIN BODY CONTAINER */}
        <main className="flex-1 min-w-0 box-border p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
