import type { Metadata } from "next";
import { Cormorant_Garamond, DM_Sans, Noto_Sans_Malayalam } from "next/font/google";

import { siteConfig } from "@/config/site";
import "./globals.css";

const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const body = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

// Malayalam text (lang="ml") renders in Noto Sans Malayalam on every device.
// Not preloaded: most pages are English-only, so it loads only when used.
const malayalam = Noto_Sans_Malayalam({
  variable: "--font-malayalam",
  subsets: ["malayalam"],
  weight: "variable",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: siteConfig.name,
    description: siteConfig.description,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${malayalam.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
