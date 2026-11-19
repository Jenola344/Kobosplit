/**
 * Where Prisma should connect.
 *
 * Local development uses the SQLite file in DATABASE_URL. A deployment uses
 * whatever hosted database the host provides, and its dashboard may expose that
 * one URL under either name, so TURSO_DATABASE_URL wins and DATABASE_URL is
 * accepted too.
 */
const LIBSQL_PROTOCOLS = ["libsql:", "https:", "http:", "wss:", "ws:"];
const POSTGRES_PROTOCOLS = ["postgres:", "postgresql:"];

export type DatabaseKind = "sqlite" | "libsql" | "postgres" | "unsupported";

export interface DatabaseTarget {
  /** The URL to connect with, once trimmed. */
  url: string | undefined;
  /** Lower-case URL scheme, e.g. "file:", "postgres:", "libsql:". */
  protocol: string | null;
  /** Which environment variable the URL came from. */
  source: "TURSO_DATABASE_URL" | "DATABASE_URL" | null;
  kind: DatabaseKind;
}

function classify(protocol: string | null): DatabaseKind {
  if (!protocol) return "unsupported";
  if (protocol === "file:") return "sqlite";
  if (LIBSQL_PROTOCOLS.includes(protocol)) return "libsql";
  if (POSTGRES_PROTOCOLS.includes(protocol)) return "postgres";
  return "unsupported";
}

export function resolveDatabaseTarget(): DatabaseTarget {
  const source = process.env.TURSO_DATABASE_URL
    ? "TURSO_DATABASE_URL"
    : process.env.DATABASE_URL
      ? "DATABASE_URL"
      : null;
  const raw = source ? process.env[source] : undefined;
  const url = raw?.trim() || undefined;

  if (!url) {
    return { url: undefined, protocol: null, source, kind: "unsupported" };
  }

  const protocol = /^[a-z][a-z0-9+.-]*:/i.exec(url)?.[0].toLowerCase() ?? null;

  return { url, protocol, source, kind: classify(protocol) };
}
