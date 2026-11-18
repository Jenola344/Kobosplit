import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptNwcUri, sha256Preimage } from "@/lib/crypto";
import { payVendorInvoice, requestVendorInvoice } from "@/lib/nwc";
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

    if (pool.status === "RELEASING") {
      return NextResponse.json(
        { error: "A release is already in progress for this pool." },
        { status: 409 }
      );
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

    // ── Claim the payout atomically ──
    // Two concurrent release requests both pass the checks above. Only the
    // request that flips FUNDED -> RELEASING may pay the vendor; the database
    // decides the winner, so the condition has to live in the WHERE clause.
    //
    // The claim carries a unique id. Status alone is not enough: if the claim is
    // handed back and a retry re-claims the pool, a stale request still sees
    // "RELEASING" — but it will never see its own claim id again.
    const claimId = randomUUID();
    const claim = await prisma.pool.updateMany({
      where: { id, status: "FUNDED", releasePreimage: null },
      data: { status: "RELEASING", releaseClaimId: claimId },
    });

    if (claim.count === 0) {
      const current = await prisma.pool.findUnique({
        where: { id },
        select: { status: true, releasePreimage: true },
      });

      if (current?.releasePreimage || current?.status === "RELEASED") {
        return NextResponse.json(
          { error: "Funds have already been released." },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: "A release is already in progress for this pool." },
        { status: 409 }
      );
    }

    // Every step below that fails before the money leaves gives the claim back,
    // so the organizer can retry. Once the vendor is paid we never roll back.
    const releaseClaim = async () => {
      await prisma.pool
        .updateMany({
          where: { id, status: "RELEASING", releaseClaimId: claimId },
          data: { status: "FUNDED", releasePaymentHash: null, releaseClaimId: null },
        })
        .catch((rollbackError) => {
          console.error("Failed to roll back release claim:", rollbackError);
        });
    };

    const nwcUrl = decryptNwcUri(pool.encryptedNwcUri);

    // 1. Resolve the vendor invoice — no money moves yet
    let vendorInvoice: { paymentRequest: string; paymentHash: string };
    try {
      vendorInvoice = await requestVendorInvoice(
        pool.vendorLnAddress,
        totalCollectedSats,
        `KoboSplit payout: ${pool.title}`
      );
    } catch (error) {
      console.error("Error resolving vendor invoice:", error);
      await releaseClaim();
      return NextResponse.json(
        { error: "Failed to release funds. Please try again." },
        { status: 500 }
      );
    }

    // 2. Record which invoice we are about to pay. If everything after this
    //    point dies mid-flight, the payout can still be proven and reconciled.
    //    Guarding on RELEASING also means an organizer who reconciles this claim
    //    away (because nothing had been paid yet) stops us before we pay.
    try {
      const recorded = await prisma.pool.updateMany({
        where: { id, status: "RELEASING", releaseClaimId: claimId },
        data: { releasePaymentHash: vendorInvoice.paymentHash },
      });

      if (recorded.count === 0) {
        console.error(
          `Release claim ${claimId} for pool ${id} was handed back before the vendor invoice was recorded; aborting before paying.`
        );
        return NextResponse.json(
          {
            error:
              "This release was cancelled before any payment was made, so nothing was paid. Start the release again.",
          },
          { status: 409 }
        );
      }
    } catch (error) {
      console.error("Failed to record vendor invoice hash:", error);
      await releaseClaim();
      return NextResponse.json(
        { error: "Failed to release funds. Please try again." },
        { status: 500 }
      );
    }

    // 3. Pay the vendor
    let preimage: string;
    try {
      const payout = await payVendorInvoice(nwcUrl, vendorInvoice.paymentRequest);
      preimage = payout.preimage;
    } catch (error) {
      console.error("Error releasing funds:", error);
      await releaseClaim();
      return NextResponse.json(
        { error: "Failed to release funds. Please try again." },
        { status: 500 }
      );
    }

    // 4. Never publish a proof we cannot verify
    if (sha256Preimage(preimage) !== vendorInvoice.paymentHash) {
      console.error(
        `CRITICAL: payout proof for pool ${id} does not hash to the vendor invoice ` +
          `${vendorInvoice.paymentHash}. Pool left in RELEASING for reconciliation.`
      );
      return NextResponse.json(
        {
          error:
            "The wallet returned a payout proof that does not match the vendor invoice. " +
            "Check the payment in your wallet, then record the payout with your organizer key.",
        },
        { status: 500 }
      );
    }

    // 5. Settle the ledger — only while this request still owns the claim
    try {
      const settled = await prisma.pool.updateMany({
        where: { id, status: "RELEASING", releaseClaimId: claimId },
        data: {
          status: "RELEASED",
          releasePreimage: preimage,
        },
      });

      if (settled.count === 0) {
        throw new Error(`claim ${claimId} was no longer held when settling`);
      }
    } catch (error) {
      // The vendor HAS been paid. Never roll back: leave the pool in RELEASING,
      // where the organizer key can record this preimage (the invoice hash is
      // already stored, so the proof can be verified).
      console.error(
        `CRITICAL: vendor paid for pool ${id} but the ledger update failed. ` +
          `Reconcile with the organizer key using preimage ${preimage}`,
        error
      );
      return NextResponse.json(
        {
          error:
            "Funds were sent to the vendor, but recording the receipt failed. " +
            "Record the payout with your organizer key — do not retry the release.",
          releasePreimage: preimage,
        },
        { status: 500 }
      );
    }

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
