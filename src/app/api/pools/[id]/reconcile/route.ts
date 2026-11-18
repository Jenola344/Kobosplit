import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sha256Preimage, verifyOrganizerToken } from "@/lib/crypto";
import { reconcileSchema, checkRateLimit } from "@/lib/security";

/**
 * Reconcile a payout that left the vendor paid but the pool stuck in RELEASING
 * (for example the ledger write failed after the money moved).
 *
 * There are two cases, decided by whether a vendor invoice was recorded:
 *
 *  - Invoice recorded: the organizer proves the payout with the preimage from
 *    their wallet. It is only accepted if sha256(preimage) equals that recorded
 *    hash, so a receipt can never be forged — not even by whoever holds the key.
 *  - No invoice recorded: the hash is written BEFORE paying, so its absence
 *    proves no payment was ever attempted. The organizer key hands the claim
 *    back to FUNDED and the pool becomes releasable again.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { allowed, retryAfterMs } = checkRateLimit(
      `reconcile:${id}`,
      5,
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
    const parsed = reconcileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { organizerToken, preimage } = parsed.data;

    const pool = await prisma.pool.findUnique({
      where: { id },
      select: {
        status: true,
        organizerTokenHash: true,
        releasePaymentHash: true,
        releasePreimage: true,
      },
    });

    if (!pool) {
      return NextResponse.json({ error: "Pool not found" }, { status: 404 });
    }

    if (pool.status === "RELEASED" || pool.releasePreimage) {
      return NextResponse.json(
        { error: "Funds have already been released." },
        { status: 400 }
      );
    }

    if (pool.status !== "RELEASING") {
      return NextResponse.json(
        { error: "This pool is not awaiting reconciliation." },
        { status: 400 }
      );
    }

    if (!pool.organizerTokenHash) {
      return NextResponse.json(
        {
          error:
            "This pool has no organizer key on record, so it cannot be reconciled. Contact the operator.",
        },
        { status: 403 }
      );
    }

    if (!verifyOrganizerToken(organizerToken, pool.organizerTokenHash)) {
      return NextResponse.json({ error: "Invalid organizer key." }, { status: 401 });
    }

    // ── Case 1: no vendor invoice on record ──
    // The invoice hash is written before the payment call, so a missing hash
    // means the payout was never attempted and the claim can be handed back.
    if (!pool.releasePaymentHash) {
      if (preimage) {
        return NextResponse.json(
          {
            error:
              "No vendor invoice was recorded for this payout, so a preimage cannot be verified. " +
              "Reconcile without a preimage to release the claim instead.",
          },
          { status: 400 }
        );
      }

      // Conditional on no invoice having been recorded: if the in-flight release
      // got as far as writing its hash, this returns 0 and settles nothing.
      const released = await prisma.pool.updateMany({
        where: { id, status: "RELEASING", releasePaymentHash: null },
        // Clearing the claim id is what stops the original request from recording
        // a hash or paying if it is still in flight — even if a retry re-claims
        // the pool in the meantime, because the retry gets its own id.
        data: { status: "FUNDED", releaseClaimId: null },
      });

      if (released.count === 0) {
        return NextResponse.json(
          {
            error:
              "This pool changed while you were reconciling. Reload and check its status before trying again.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json({ status: "FUNDED", claimReleased: true });
    }

    // ── Case 2: a vendor invoice is on record and must be proven ──
    if (!preimage) {
      return NextResponse.json(
        {
          error:
            "A payout preimage is required: a vendor invoice was recorded for this pool, so a payment may have been made.",
        },
        { status: 400 }
      );
    }

    if (sha256Preimage(preimage) !== pool.releasePaymentHash) {
      return NextResponse.json(
        {
          error:
            "That preimage does not hash to the vendor invoice recorded for this pool.",
        },
        { status: 400 }
      );
    }

    // Condition on RELEASING + no preimage so a concurrent reconcile or release
    // cannot settle the same payout twice.
    const settled = await prisma.pool.updateMany({
      where: { id, status: "RELEASING", releasePreimage: null },
      data: { status: "RELEASED", releasePreimage: preimage },
    });

    if (settled.count === 0) {
      return NextResponse.json(
        { error: "Funds have already been released." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      status: "RELEASED",
      releasePreimage: preimage,
    });
  } catch (error) {
    console.error("Error reconciling payout:", error);
    return NextResponse.json(
      { error: "Failed to reconcile this payout. Please try again." },
      { status: 500 }
    );
  }
}
