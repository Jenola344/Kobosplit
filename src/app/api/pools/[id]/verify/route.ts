import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptNwcUri } from "@/lib/crypto";
import { checkInvoicePaid } from "@/lib/nwc";
import { verifySchema, checkRateLimit } from "@/lib/security";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit: 30 verifications per minute per pool
    const { allowed, retryAfterMs } = checkRateLimit(
      `verify:${id}`,
      30,
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
    const parsed = verifySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { paymentHash } = parsed.data;

    // Find the contribution
    const contribution = await prisma.contribution.findUnique({
      where: { paymentHash },
      include: { pool: true },
    });

    if (!contribution || contribution.poolId !== id) {
      return NextResponse.json(
        { error: "Contribution not found" },
        { status: 404 }
      );
    }

    // If already paid, return cached result
    if (contribution.status === "PAID" && contribution.preimage) {
      const pool = await prisma.pool.findUnique({ where: { id } });
      return NextResponse.json({
        settled: true,
        preimage: contribution.preimage,
        poolStatus: pool?.status ?? contribution.pool.status,
      });
    }

    // Check with NWC
    const nwcUrl = decryptNwcUri(contribution.pool.encryptedNwcUri);
    const { settled, preimage } = await checkInvoicePaid(nwcUrl, paymentHash);

    if (!settled || !preimage) {
      return NextResponse.json({
        settled: false,
        preimage: null,
        poolStatus: contribution.pool.status,
      });
    }

    // Atomically update contribution and check if pool is fully funded
    const [updatedContribution] = await prisma.$transaction([
      prisma.contribution.update({
        where: { paymentHash },
        data: { status: "PAID", preimage },
      }),
      // No-op to make it a transaction
      prisma.pool.findUnique({ where: { id } }),
    ]);

    // Recalculate total paid sats
    const paidContributions = await prisma.contribution.findMany({
      where: { poolId: id, status: "PAID" },
      select: { amountSats: true },
    });

    const totalPaid = paidContributions.reduce(
      (sum, c) => sum + c.amountSats,
      0
    );

    let poolStatus = contribution.pool.status;

    // Transition to FUNDED if target reached
    if (totalPaid >= contribution.pool.targetSats && poolStatus === "OPEN") {
      await prisma.pool.update({
        where: { id },
        data: { status: "FUNDED" },
      });
      poolStatus = "FUNDED";
    }

    return NextResponse.json({
      settled: true,
      preimage: updatedContribution.preimage,
      poolStatus,
    });
  } catch (error) {
    console.error("Error verifying payment:", error);
    return NextResponse.json(
      { error: "Failed to verify payment" },
      { status: 500 }
    );
  }
}
