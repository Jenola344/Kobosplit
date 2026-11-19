import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveDatabaseTarget } from "@/lib/database-url";

// Always executed at request time; nothing here can be prerendered.
export const dynamic = "force-dynamic";

/**
 * Deployment diagnostics: reports how the database is configured and, when a
 * query fails, the database's own error code and message. Without this a failed
 * deployment only shows Next's opaque "server-side exception" digest, because
 * the runtime logs live in the hosting dashboard.
 *
 * Credentials are never returned, only which variable was used and its scheme.
 */
function describeDatabase() {
  const target = resolveDatabaseTarget();

  return {
    mode: target.url
      ? `${target.kind} (${target.source} is a ${target.protocol} URL)`
      : "unconfigured (no database URL)",
    kind: target.kind,
    urlSource: target.source,
    urlProtocol: target.protocol,
    tursoAuthTokenSet: Boolean(process.env.TURSO_AUTH_TOKEN),
    encryptionSecretSet: Boolean(process.env.ENCRYPTION_SECRET),
    demoWalletConfigured: Boolean(process.env.DEMO_NWC_URI),
  };
}

export async function GET() {
  const configuration = describeDatabase();

  try {
    const [poolCount, contributionCount] = await Promise.all([
      prisma.pool.count(),
      prisma.contribution.count(),
    ]);

    return NextResponse.json(
      { ok: true, ...configuration, poolCount, contributionCount },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    console.error("[health] database check failed:", error);

    const cause = error as {
      name?: string;
      message?: string;
      code?: string;
      errorCode?: string;
    };

    return NextResponse.json(
      {
        ok: false,
        ...configuration,
        error: {
          name: cause?.name ?? "Error",
          code: cause?.errorCode ?? cause?.code ?? null,
          message: cause?.message ?? String(error),
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
