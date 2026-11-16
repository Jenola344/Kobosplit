import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KoboSplit — Group Splits & Micro-Escrow",
  description:
    "Non-custodial Bitcoin Lightning group split and micro-escrow for campus and market communities across Africa.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <header className="border-b border-[var(--border)] bg-white/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2 font-bold text-xl">
              <span className="text-2xl">⚡</span>
              <span>
                Kobo<span className="text-[var(--primary)]">Split</span>
              </span>
            </a>
            <a
              href="/create"
              className="bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors min-h-[44px] flex items-center"
            >
              + New Split
            </a>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-6">{children}</main>
        <footer className="border-t border-[var(--border)] mt-12">
          <div className="max-w-4xl mx-auto px-4 py-6 text-center text-sm text-[var(--muted)]">
            Built for{" "}
            <strong className="text-[var(--foreground)]">
              Dakar Bitcoin Hack by BTrust
            </strong>{" "}
            · Non-custodial · Open Source
          </div>
        </footer>
      </body>
    </html>
  );
}
