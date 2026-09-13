import type { Metadata } from "next";
import { Inter_Tight } from "next/font/google";
import "./globals.css";

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter-tight",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Saunaboy Command Center",
  description: "SB Command Center: Shopify, Meta Ads, Monday.com and Google Meet in one view.",
};

/** The shell is just the page frame: the header is per-page (app/_components/
 *  AppHeader.tsx), because a layout never receives searchParams and the whole
 *  header is driven by the ?from&to range. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={interTight.variable}>
      <body>
        <div className="page">{children}</div>
      </body>
    </html>
  );
}
