import type { Metadata } from "next";
import { ToasterClient } from "@/components/ToasterClient";
import "./globals.css";

export const metadata: Metadata = {
  title: "IFRS.ai - IFRS Compliance Automated by AI",
  description: "Stop spending 4 days on lease calculations. Upload your contract, get audit-ready reports in 4 minutes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <noscript>
          <div className="p-4 bg-amber-100 text-amber-950 text-sm">
            JavaScript is required to run IFRS.ai. Enable it in your browser and reload.
          </div>
        </noscript>
        {children}
        <ToasterClient />
      </body>
    </html>
  );
}
