import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptNwcUri } from "@/lib/crypto";
import { createPoolInvoice } from "@/lib/nwc";
import { contributeSchema, checkRateLimit } from "@/lib/security";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Rate limit: 10 contributions per minute per pool
    const { allowed, retryAfterMs } = checkRateLimit(
      `contribute:${id}`,
      10,
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
    const parsed = contributeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { nickname, amountSats } = parsed.data;

    const pool = await prisma.pool.findUnique({ where: { id } });
    if (!pool) {
      return NextResponse.json({ error: "Pool not found" }, { status: 404 });
    }

    if (pool.status !== "OPEN") {
      return NextResponse.json(
        { error: "This pool is no longer accepting contributions." },
        { status: 400 }
      );
    }

    // Decrypt NWC URI in memory only
    const nwcUrl = decryptNwcUri(pool.encryptedNwcUri);

    // Create Lightning invoice via NWC
    const memo = `KoboSplit: ${nickname} → ${pool.title}`;
    const { bolt11, paymentHash } = await createPoolInvoice(
      nwcUrl,
      amountSats,
      memo
    );

    // Save PENDING contribution
    const contribution = await prisma.contribution.create({
      data: {
        poolId: id,
        nickname,
        amountSats,
        paymentHash,
        bolt11,
        status: "PENDING",
      },
    });

    return NextResponse.json(
      {
        contributionId: contribution.id,
        bolt11,
        paymentHash,
        amountSats,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating contribution:", error);
    return NextResponse.json(
      { error: "Failed to create payment. Please try again." },
      { status: 500 }
    );
  }
}
