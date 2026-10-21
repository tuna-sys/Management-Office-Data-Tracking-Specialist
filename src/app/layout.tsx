import type { Metadata } from "next";
import "./globals.css";
import AntdRegistry from "@/components/AntdRegistry";
import Navigation from "@/components/Navigation";
import { ConfigProvider } from "antd";
import viVN from "antd/locale/vi_VN";

export const metadata: Metadata = {
  title: "L-Incentive v2.0 - Quản Trị Lao Động & Định Mức Thưởng 2026",
  description:
    "Hệ thống Quản Trị Lao Động, Định Mức Công, Xác Thực STK & Chi Trả Thưởng",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased font-sans">
        <AntdRegistry>
          <ConfigProvider
            locale={viVN}
            theme={{
              token: {
                colorPrimary: "#2563eb",
                borderRadius: 10,
                fontFamily: "inherit",
                colorBgContainer: "#ffffff",
              },
              components: {
                Card: {
                  borderRadiusLG: 14,
                },
                Table: {
                  borderRadius: 10,
                },
                Button: {
                  borderRadius: 8,
                },
              },
            }}
          >
            <Navigation>{children}</Navigation>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
