import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SB",
  description: "SB Command Center: Shopify, Meta Ads, Monday.com and Google Meet in one view.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <aside className="app-nav">
            <h1>SB Command Center</h1>
            <nav>
              <Link href="/">Overview</Link>
              <Link href="/integrations">Integrations</Link>
            </nav>
          </aside>
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
