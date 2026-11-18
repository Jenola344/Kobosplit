import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRateInfo, satsToFiat } from "@/lib/rates";
import PoolPageClient from "./PoolPageClient";

// Contributions land while the page is shared; always serve fresh ledger data.
export const dynamic = "force-dynamic";

async function getPoolData(id: string) {
  const pool = await prisma.pool.findUnique({
    where: { id },
    include: {
      contributions: {
        where: { status: "PAID" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          nickname: true,
          amountSats: true,
          preimage: true,
          createdAt: true,
        },
      },
    },
  });

  if (!pool) return null;

  const collectedSats = pool.contributions.reduce(
    (sum, c) => sum + c.amountSats,
    0
  );

  const currency = pool.fiatCurrency as "NGN" | "XOF";
  const symbol = currency === "NGN" ? "₦" : "CFA ";

  let targetFiat: number;
  let collectedFiat: number;
  let rateIsFallback = true;
  try {
    [targetFiat, collectedFiat] = await Promise.all([
      satsToFiat(pool.targetSats, currency),
      satsToFiat(collectedSats, currency),
    ]);
    rateIsFallback = (await getRateInfo(currency)).isFallback;
  } catch {
    targetFiat = 0;
    collectedFiat = 0;
  }

  return {
    id: pool.id,
    title: pool.title,
    description: pool.description,
    targetSats: pool.targetSats,
    fiatCurrency: pool.fiatCurrency,
    vendorLnAddress: pool.vendorLnAddress,
    status: pool.status,
    releasePreimage: pool.releasePreimage,
    payoutInvoiceRecorded: Boolean(pool.releasePaymentHash),
    collectedSats,
    contributorCount: pool.contributions.length,
    progress: Math.min(
      100,
      Math.round((collectedSats / pool.targetSats) * 100)
    ),
    targetFiat: `${symbol}${targetFiat.toLocaleString()}`,
    collectedFiat: `${symbol}${collectedFiat.toLocaleString()}`,
    rateIsFallback,
    createdAt: pool.createdAt.toISOString(),
    expiresAt: pool.expiresAt.toISOString(),
    contributions: pool.contributions.map((c) => ({
      id: c.id,
      nickname: c.nickname,
      amountSats: c.amountSats,
      receiptId: c.preimage ? c.preimage.slice(0, 12) + "..." : null,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

export default async function PoolPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pool = await getPoolData(id);

  if (!pool) {
    notFound();
  }

  return <PoolPageClient initialPool={pool} />;
}
