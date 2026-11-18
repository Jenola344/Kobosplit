import Link from "next/link";
import { prisma } from "@/lib/db";
import { getRateInfo, satsToFiat } from "@/lib/rates";

// Pools change constantly; always render from the database, never a build-time snapshot.
export const dynamic = "force-dynamic";

interface PoolWithContributions {
  id: string;
  title: string;
  description: string | null;
  targetSats: number;
  fiatCurrency: string;
  vendorLnAddress: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  contributions: { amountSats: number }[];
}

async function getPools(): Promise<PoolWithContributions[]> {
  return prisma.pool.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      contributions: {
        where: { status: "PAID" },
        select: { amountSats: true },
      },
    },
  });
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    OPEN: "bg-sky-400/10 text-sky-300 ring-sky-400/30",
    FUNDED: "bg-amber-400/10 text-amber-300 ring-amber-400/30",
    RELEASING: "bg-amber-400/10 text-amber-300 ring-amber-400/30 animate-pulse",
    RELEASED: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30",
    REFUNDED: "bg-white/5 text-[var(--muted)] ring-white/15",
  };
  const labels: Record<string, string> = {
    OPEN: "Accepting Contributions",
    FUNDED: "Fully Funded — Ready to Release",
    RELEASING: "Releasing Funds to Vendor…",
    RELEASED: "Funds Sent to Vendor ✓",
    REFUNDED: "Refunded",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
        colors[status] || "bg-white/5 text-[var(--muted)] ring-white/15"
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

async function PoolCard({
  pool,
  index,
}: {
  pool: PoolWithContributions;
  index: number;
}) {
  const collectedSats = pool.contributions.reduce(
    (sum, c) => sum + c.amountSats,
    0
  );
  const progress = Math.min(
    100,
    Math.round((collectedSats / pool.targetSats) * 100)
  );
  const currency = pool.fiatCurrency as "NGN" | "XOF";
  const symbol = currency === "NGN" ? "₦" : "CFA ";

  let targetFiat: number;
  let collectedFiat: number;
  try {
    [targetFiat, collectedFiat] = await Promise.all([
      satsToFiat(pool.targetSats, currency),
      satsToFiat(collectedSats, currency),
    ]);
  } catch {
    targetFiat = 0;
    collectedFiat = 0;
  }

  return (
    <Link
      href={`/pool/${pool.id}`}
      className="card card-hover animate-rise block p-5"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="mb-3 flex flex-col-reverse items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
        <h3 className="text-base font-semibold leading-tight tracking-tight text-balance">
          {pool.title}
        </h3>
        <StatusBadge status={pool.status} />
      </div>

      {pool.description && (
        <p className="mb-4 line-clamp-2 text-sm text-[var(--muted)]">
          {pool.description}
        </p>
      )}

      {/* Progress bar */}
      <div className="mb-2">
        <div className="num mb-1.5 flex justify-between text-xs text-[var(--muted)]">
          <span>
            {collectedSats.toLocaleString()} / {pool.targetSats.toLocaleString()}{" "}
            sats
          </span>
          <span className="font-semibold text-[var(--foreground)]">
            {progress}%
          </span>
        </div>
        <div className="track">
          <div
            className={`fill ${progress >= 100 ? "fill-done" : ""}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="num mt-1.5 flex justify-between text-xs text-[var(--muted)]">
          <span>
            ~{symbol}
            {collectedFiat.toLocaleString()}
          </span>
          <span>
            ~{symbol}
            {targetFiat.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
        <span className="num">👥 {pool.contributions.length} contributors</span>
        <span className="truncate font-mono text-[11px]">
          ⚡ {pool.vendorLnAddress}
        </span>
      </div>
    </Link>
  );
}

export default async function HomePage() {
  const [pools, rates] = await Promise.all([getPools(), getRateInfo("NGN")]);

  const totalCollected = pools.reduce(
    (sum, pool) =>
      sum +
      pool.contributions.reduce((poolSum, c) => poolSum + c.amountSats, 0),
    0
  );

  return (
    <div>
      {/* Hero */}
      <section className="relative pb-12 pt-4 text-center sm:pt-10">
        <div
          className="animate-rise inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]"
        >
          <span className="pulse-dot" />
          Non-custodial escrow on Lightning
        </div>

        <h1
          className="animate-rise mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight text-balance sm:text-5xl"
          style={{ animationDelay: "90ms" }}
        >
          Split costs with your group{" "}
          <span className="text-gradient">at lightning speed</span>
        </h1>

        <p
          className="animate-rise mx-auto mt-4 max-w-xl text-base text-[var(--muted)] sm:text-lg"
          style={{ animationDelay: "170ms" }}
        >
          KoboSplit pools contributions into a non-custodial escrow, verifies
          every payment, then releases to the vendor on Lightning.
        </p>

        <div
          className="animate-rise mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          style={{ animationDelay: "250ms" }}
        >
          <Link href="/create" className="btn btn-primary w-full text-base sm:w-auto">
            ⚡ Create New Split Pool
          </Link>
          <a href="#pools" className="btn btn-ghost w-full text-sm sm:w-auto">
            Browse pools
          </a>
        </div>

        <dl
          className="animate-rise mx-auto mt-10 grid max-w-md grid-cols-2 gap-3"
          style={{ animationDelay: "330ms" }}
        >
          <div className="card px-4 py-3">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Open pools
            </dt>
            <dd className="num mt-1 text-2xl font-bold">
              {pools.filter((p) => p.status === "OPEN").length}
            </dd>
          </div>
          <div className="card px-4 py-3">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Sats pooled
            </dt>
            <dd className="num mt-1 text-2xl font-bold text-[var(--primary)]">
              {totalCollected.toLocaleString()}
            </dd>
          </div>
        </dl>
      </section>

      {/* Pool list */}
      <section id="pools" className="scroll-mt-24">
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Active Pools</h2>
          <span className="text-xs text-[var(--muted)]">
            {pools.length} total
          </span>
        </div>

        {rates.isFallback && (
          <p className="mb-3 inline-flex items-start gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-light)] px-3 py-2 text-xs text-[var(--warning)]">
            ⚠️ Live exchange rate unavailable — NGN and XOF amounts below are
            built-in estimates.
          </p>
        )}

        {pools.length === 0 ? (
          <div className="card animate-rise flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="text-4xl">⚡</span>
            <p className="text-lg font-medium">No pools yet</p>
            <p className="max-w-xs text-sm text-[var(--muted)]">
              Create the first split pool and share the link with your group.
            </p>
            <Link href="/create" className="btn btn-primary mt-2 text-sm">
              + Create a pool
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {pools.map((pool, i) => (
              <PoolCard key={pool.id} pool={pool} index={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
