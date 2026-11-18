import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptNwcUri, generateOrganizerToken, sha256Hex } from "@/lib/crypto";
import { createPoolSchema } from "@/lib/security";
import { checkRateLimit } from "@/lib/security";

export async function GET() {
  try {
    const pools = await prisma.pool.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        targetSats: true,
        fiatCurrency: true,
        vendorLnAddress: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        contributions: {
          where: { status: "PAID" },
          select: { amountSats: true },
        },
      },
    });

    const result = pools.map((pool) => {
      const collectedSats = pool.contributions.reduce(
        (sum, c) => sum + c.amountSats,
        0
      );
      return {
        id: pool.id,
        title: pool.title,
        description: pool.description,
        targetSats: pool.targetSats,
        fiatCurrency: pool.fiatCurrency,
        vendorLnAddress: pool.vendorLnAddress,
        status: pool.status,
        collectedSats,
        contributorCount: pool.contributions.length,
        progress: Math.min(
          100,
          Math.round((collectedSats / pool.targetSats) * 100)
        ),
        createdAt: pool.createdAt.toISOString(),
        expiresAt: pool.expiresAt.toISOString(),
      };
    });

    return NextResponse.json({ pools: result });
  } catch (error) {
    console.error("Error fetching pools:", error);
    return NextResponse.json(
      { error: "Failed to fetch pools" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    // Rate limit: 5 pool creations per minute per route
    const { allowed, retryAfterMs } = checkRateLimit(
      "create-pool",
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
    const parsed = createPoolSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { title, description, targetSats, fiatCurrency, vendorLnAddress, nwcUri, useDemoWallet, expiresInHours } = parsed.data;

    // Determine which NWC URI to use
    let rawNwcUri: string;
    if (useDemoWallet) {
      const demoUri = process.env.DEMO_NWC_URI;
      if (!demoUri) {
        return NextResponse.json(
          {
            error:
              "Demo wallet is not configured. Please provide your own NWC connection URI.",
          },
          { status: 400 }
        );
      }
      rawNwcUri = demoUri;
    } else {
      if (!nwcUri) {
        return NextResponse.json(
          { error: "NWC connection URI is required when not using demo wallet." },
          { status: 400 }
        );
      }
      rawNwcUri = nwcUri;
    }

    // Encrypt NWC URI before storing
    const encryptedUri = encryptNwcUri(rawNwcUri);

    // Handed back to the organizer exactly once; only its hash is stored
    const organizerToken = generateOrganizerToken();

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const pool = await prisma.pool.create({
      data: {
        title,
        description: description ?? null,
        targetSats,
        fiatCurrency,
        vendorLnAddress,
        encryptedNwcUri: encryptedUri,
        organizerTokenHash: sha256Hex(organizerToken),
        expiresAt,
      },
    });

    return NextResponse.json(
      {
        id: pool.id,
        title: pool.title,
        status: pool.status,
        targetSats: pool.targetSats,
        fiatCurrency: pool.fiatCurrency,
        vendorLnAddress: pool.vendorLnAddress,
        createdAt: pool.createdAt.toISOString(),
        expiresAt: pool.expiresAt.toISOString(),
        // Returned once, never retrievable afterwards
        organizerToken,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating pool:", error);
    return NextResponse.json(
      { error: "Failed to create pool" },
      { status: 500 }
    );
  }
}
