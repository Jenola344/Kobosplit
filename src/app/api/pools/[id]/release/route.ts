import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptNwcUri } from "@/lib/crypto";
import { releasePoolFunds } from "@/lib/nwc";
import { releaseSchema, checkRateLimit } from "@/lib/security";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit: 3 release attempts per minute per pool
    const { allowed, retryAfterMs } = checkRateLimit(
      `release:${id}`,
      3,
      60_000
    );
    if (!allowed) {
      return NextResponse.json(
        {
          error: `Too many requests. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
        },
        { status: 429 }
      );
    }

    const body = await request.json();
    const parsed = releaseSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const pool = await prisma.pool.findUnique({
      where: { id },
      include: {
        contributions: {
          where: { status: "PAID" },
          select: { amountSats: true },
        },
      },
    });

    if (!pool) {
      return NextResponse.json({ error: "Pool not found" }, { status: 404 });
    }

    if (pool.status !== "FUNDED") {
      return NextResponse.json(
        {
          error:
            pool.status === "RELEASED"
              ? "Funds have already been released."
              : "Pool is not fully funded yet.",
        },
        { status: 400 }
      );
    }

    // Prevent double payouts
    if (pool.releasePreimage) {
      return NextResponse.json(
        { error: "Funds have already been released." },
        { status: 400 }
      );
    }

    const totalCollectedSats = pool.contributions.reduce(
      (sum, c) => sum + c.amountSats,
      0
    );

    // Decrypt NWC URI and release funds to vendor
    const nwcUrl = decryptNwcUri(pool.encryptedNwcUri);
    const { preimage } = await releasePoolFunds(
      nwcUrl,
      pool.vendorLnAddress,
      totalCollectedSats,
      `KoboSplit payout: ${pool.title}`
    );

    // Update pool status
    await prisma.pool.update({
      where: { id },
      data: {
        status: "RELEASED",
        releasePreimage: preimage,
      },
    });

    return NextResponse.json({
      status: "RELEASED",
      releasePreimage: preimage,
      totalReleasedSats: totalCollectedSats,
      vendorLnAddress: pool.vendorLnAddress,
    });
  } catch (error) {
    console.error("Error releasing funds:", error);
    return NextResponse.json(
      { error: "Failed to release funds. Please try again." },
      { status: 500 }
    );
  }
}
