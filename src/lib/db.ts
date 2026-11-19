import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql/web";
import { resolveDatabaseTarget } from "./database-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Local development, the seed script and the mock harness all run against a
 * SQLite file (DATABASE_URL="file:./dev.db"). A deployment cannot: serverless
 * filesystems are read-only and each instance gets its own copy, which fails
 * with "Error code 14: Unable to open the database file".
 *
 * When a hosted libSQL database (Turso) is configured — as TURSO_DATABASE_URL,
 * or as a libsql:// URL in DATABASE_URL — Prisma talks to it through its driver
 * adapter instead. The dialect stays SQLite, so the schema, queries and local
 * file database are unchanged.
 */
function createPrismaClient(): PrismaClient {
  const target = resolveDatabaseTarget();

  if (!target.isRemote) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        `[db] ${target.source ? `${target.source} is set to a ${target.protocol} URL` : "No database URL is set"}, ` +
          "so Prisma is about to open a local SQLite file. A serverless deployment cannot do that — " +
          "set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) to a libsql:// database."
      );
    }
    return new PrismaClient();
  }

  return new PrismaClient({
    adapter: new PrismaLibSQL({
      url: target.url!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    }),
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
