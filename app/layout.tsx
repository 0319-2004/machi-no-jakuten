import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = "https://0319-2004.github.io/machi-no-jakuten/";
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const faviconUrl = `${basePath}/favicon.png`;
const openGraphImageUrl =
  "https://0319-2004.github.io/machi-no-jakuten/og-flood-v2.png";
const title = "街の弱点｜高島平・舟渡 水害編";
const description =
  "高島平・舟渡の洪水を、雨の発生頻度と破堤後の時間変化から具体的に理解する地域限定版。";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f1e8",
};

export const dynamic = "force-static";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: siteUrl },
  icons: {
    icon: faviconUrl,
    shortcut: faviconUrl,
  },
  openGraph: {
    title,
    description,
    type: "website",
    locale: "ja_JP",
    url: siteUrl,
    images: [
      {
        url: openGraphImageUrl,
        width: 1200,
        height: 630,
        alt: "街の弱点 — 高島平・舟渡 水害編",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [openGraphImageUrl],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
