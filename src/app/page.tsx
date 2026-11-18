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
    OPEN: "bg-blue-100 text-blue-800",
    FUNDED: "bg-yellow-100 text-yellow-800",
    RELEASING: "bg-yellow-100 text-yellow-800",
    RELEASED: "bg-green-100 text-green-800",
    REFUNDED: "bg-gray-100 text-gray-800",
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
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${colors[status] || "bg-gray-100 text-gray-800"}`}
    >
      {labels[status] || status}
    </span>
  );
}

async function PoolCard({ pool }: { pool: PoolWithContributions }) {
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
      className="block border border-[var(--border)] rounded-xl p-5 hover:shadow-md transition-shadow bg-white"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-semibold text-base leading-tight">{pool.title}</h3>
        <StatusBadge status={pool.status} />
      </div>

      {pool.description && (
        <p className="text-sm text-[var(--muted)] mb-4 line-clamp-2">
          {pool.description}
        </p>
      )}

      {/* Progress bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs text-[var(--muted)] mb-1">
          <span>
            {collectedSats.toLocaleString()} / {pool.targetSats.toLocaleString()}{" "}
            sats
          </span>
          <span>{progress}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              progress >= 100
                ? "bg-[var(--success)]"
                : "bg-[var(--primary)]"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-[var(--muted)] mt-1">
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

      <div className="flex items-center justify-between mt-3 text-xs text-[var(--muted)]">
        <span>👥 {pool.contributions.length} contributors</span>
        <span>⚡ {pool.vendorLnAddress}</span>
      </div>
    </Link>
  );
}

export default async function HomePage() {
  const [pools, rates] = await Promise.all([getPools(), getRateInfo("NGN")]);

  return (
    <div>
      {/* Hero */}
      <section className="text-center py-10">
        <h1 className="text-3xl sm:text-4xl font-bold mb-3">
          ⚡ Kobo<span className="text-[var(--primary)]">Split</span>
        </h1>
        <p className="text-lg text-[var(--muted)] max-w-lg mx-auto mb-6">
          Split costs instantly with your group using Bitcoin Lightning.
          Non-custodial, no sign-up, no fees beyond the network.
        </p>
        <Link
          href="/create"
          className="inline-flex items-center gap-2 bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white font-semibold px-6 py-3 rounded-xl text-base transition-colors min-h-[44px]"
        >
          + Create New Split Pool
        </Link>
      </section>

      {/* Pool list */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Active Pools</h2>
        {rates.isFallback && (
          <p className="text-xs text-[var(--warning)] mb-3">
            ⚠️ Live exchange rate unavailable — NGN and XOF amounts below are built-in estimates.
          </p>
        )}
        {pools.length === 0 ? (
          <div className="text-center py-12 text-[var(--muted)]">
            <p className="text-lg mb-2">No pools yet</p>
            <p className="text-sm">
              Create the first split pool to get started!
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {pools.map((pool) => (
              <PoolCard key={pool.id} pool={pool} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
