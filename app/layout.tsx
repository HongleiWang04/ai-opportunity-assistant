import type { Metadata } from "next";
import "./globals.css";
import "./workspace.css";

export const metadata: Metadata = {
  title: "商机助手 · 一句话查商机",
  description: "描述团队、年份和项目进度，核对商机清单，导出完整Excel。所有业务数据均为模拟数据。",
  icons: {
    icon: "/avatars/robot.png",
    shortcut: "/avatars/robot.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
