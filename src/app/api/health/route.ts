import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveDatabaseTarget } from "@/lib/database-url";

// Always executed at request time; nothing here can be prerendered.
export const dynamic = "force-dynamic";

function describeDatabase() {
  const target = resolveDatabaseTarget();
  const mode = target.isRemote
    ? "libsql-remote"
    : target.url
      ? `local-sqlite (${target.source} is a ${target.protocol ?? "scheme-less"} URL)`
      : "local-sqlite (no database URL is set)";

  return {
    mode,
    urlSource: target.source,
    urlProtocol: target.protocol,
    tursoAuthTokenSet: Boolean(process.env.TURSO_AUTH_TOKEN),
  };
}

/**
 * Deployment diagnostics: reports how the database is configured and, when a
 * query fails, the database's own error code and message. Without this a failed
 * deployment only shows Next's opaque "server-side exception" digest, because
 * the runtime logs live in the Vercel dashboard.
 *
 * The auth token is never returned, only whether one is present.
 */
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
