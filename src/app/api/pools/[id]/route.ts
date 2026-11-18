import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRateInfo, satsToFiat } from "@/lib/rates";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

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

    if (!pool) {
      return NextResponse.json({ error: "Pool not found" }, { status: 404 });
    }

    const collectedSats = pool.contributions.reduce(
      (sum, c) => sum + c.amountSats,
      0
    );

    const currency = pool.fiatCurrency as "NGN" | "XOF";
    const [targetFiat, collectedFiat, rateInfo] = await Promise.all([
      satsToFiat(pool.targetSats, currency),
      satsToFiat(collectedSats, currency),
      getRateInfo(currency),
    ]);

    const symbol = currency === "NGN" ? "₦" : "CFA ";

    return NextResponse.json({
      id: pool.id,
      title: pool.title,
      description: pool.description,
      targetSats: pool.targetSats,
      fiatCurrency: pool.fiatCurrency,
      vendorLnAddress: pool.vendorLnAddress,
      status: pool.status,
      releasePreimage: pool.releasePreimage,
      // Tells the organizer UI whether a stuck release can be proven (invoice
      // recorded) or merely handed back (nothing was paid).
      payoutInvoiceRecorded: Boolean(pool.releasePaymentHash),
      collectedSats,
      contributorCount: pool.contributions.length,
      progress: Math.min(
        100,
        Math.round((collectedSats / pool.targetSats) * 100)
      ),
      targetFiat: `${symbol}${targetFiat.toLocaleString()}`,
      collectedFiat: `${symbol}${collectedFiat.toLocaleString()}`,
      rateIsFallback: rateInfo.isFallback,
      createdAt: pool.createdAt.toISOString(),
      expiresAt: pool.expiresAt.toISOString(),
      contributions: pool.contributions.map((c) => ({
        id: c.id,
        nickname: c.nickname,
        amountSats: c.amountSats,
        receiptId: c.preimage ? c.preimage.slice(0, 12) + "..." : null,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching pool:", error);
    return NextResponse.json(
      { error: "Failed to fetch pool" },
      { status: 500 }
    );
  }
}
