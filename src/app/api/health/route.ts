import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Always executed at request time; nothing here can be prerendered.
export const dynamic = "force-dynamic";

function databaseMode(): string {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return "sqlite-file (TURSO_DATABASE_URL is not set)";
  if (/^file:/i.test(url)) return "sqlite-file (TURSO_DATABASE_URL is a file: path)";
  return "libsql-remote";
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
  const configuration = {
    mode: databaseMode(),
    tursoAuthTokenSet: Boolean(process.env.TURSO_AUTH_TOKEN),
  };

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
