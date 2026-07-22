import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "源页",
  applicationName: "源页",
  description: "源页（PageRoot）— Edit visually. Stay in source.",
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    title: "源页",
    description: "PageRoot · Edit visually. Stay in source.",
    images: [
      {
        url: "/brand-logo.png",
        width: 512,
        height: 512,
        alt: "源页",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "源页",
    description: "PageRoot · Edit visually. Stay in source.",
    images: ["/brand-logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
