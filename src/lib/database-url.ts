/**
 * Where Prisma should connect.
 *
 * Local development uses the SQLite file in DATABASE_URL. A deployment needs a
 * hosted libSQL database instead, and a dashboard may expose that one URL under
 * either name, so TURSO_DATABASE_URL wins and DATABASE_URL is accepted too when
 * it already points at a networked libSQL server.
 */
const REMOTE_PROTOCOLS = ["libsql:", "https:", "http:", "wss:", "ws:"];

export interface DatabaseTarget {
  /** The URL to connect with, once trimmed. */
  url: string | undefined;
  /** True when the URL is a networked libSQL server rather than a local file. */
  isRemote: boolean;
  /** Lower-case URL scheme, e.g. "file:", "libsql:", "postgresql:". */
  protocol: string | null;
  /** Which environment variable the URL came from. */
  source: "TURSO_DATABASE_URL" | "DATABASE_URL" | null;
}

export function resolveDatabaseTarget(): DatabaseTarget {
  const source = process.env.TURSO_DATABASE_URL
    ? "TURSO_DATABASE_URL"
    : process.env.DATABASE_URL
      ? "DATABASE_URL"
      : null;
  const raw = source ? process.env[source] : undefined;
  const url = raw?.trim() || undefined;

  if (!url) return { url: undefined, isRemote: false, protocol: null, source };

  const protocol = /^[a-z][a-z0-9+.-]*:/i.exec(url)?.[0].toLowerCase() ?? null;

  return {
    url,
    isRemote: protocol !== null && REMOTE_PROTOCOLS.includes(protocol),
    protocol,
    source,
  };
}
