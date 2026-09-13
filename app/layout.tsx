import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SB",
  description: "SB Command Center: Shopify, Meta Ads, Monday.com and Google Meet in one view.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
