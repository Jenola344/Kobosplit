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
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] antialiased">
        {/* Animated backdrop: drifting aurora orbs, panning grid, sparks, grain. */}
        <div className="site-bg" aria-hidden="true">
          <div className="orb orb-a" />
          <div className="orb orb-b" />
          <div className="orb orb-c" />
          <div className="grid-layer" />
          <div className="sparks">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="grain" />
        </div>

        <header className="site-header sticky top-0 z-50">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <a href="/" className="group flex items-center gap-2 text-xl font-bold">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)]/15 text-xl ring-1 ring-[var(--primary)]/30 transition-transform duration-300 group-hover:scale-110">
                ⚡
              </span>
              <span className="tracking-tight">
                Kobo<span className="text-[var(--primary)]">Split</span>
              </span>
            </a>
            <nav className="flex items-center gap-2">
              <a
                href="/"
                className="hidden rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)] sm:block"
              >
                Pools
              </a>
              <a href="/create" className="btn btn-primary min-h-[44px] px-4 py-2 text-sm">
                + New Split
              </a>
            </nav>
          </div>
        </header>

        <main className="relative z-10 mx-auto max-w-4xl px-4 py-8">{children}</main>

        <footer className="relative z-10 mt-16 border-t border-[var(--border)]">
          <div className="mx-auto flex max-w-4xl flex-col items-center gap-2 px-4 py-8 text-center text-sm text-[var(--muted)]">
            <p>
              Built for{" "}
              <strong className="text-[var(--foreground)]">
                Dakar Bitcoin Hack by BTrust
              </strong>
            </p>
            <p className="flex items-center gap-2 text-xs">
              <span className="pulse-dot" />
              Non-custodial · Lightning Network · Open Source
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
