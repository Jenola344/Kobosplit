import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql/web";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Local development, the seed script and the mock harness all run against a
 * SQLite file (DATABASE_URL="file:./dev.db"). A deployment cannot: serverless
 * filesystems are read-only and each instance gets its own copy, which fails
 * with "Error code 14: Unable to open the database file".
 *
 * When a hosted libSQL database (Turso) is configured, Prisma talks to it
 * through its driver adapter instead. The dialect stays SQLite, so the schema,
 * queries and local file database are unchanged.
 */
function createPrismaClient(): PrismaClient {
  const url = process.env.TURSO_DATABASE_URL;
  // file: URLs are the local database; only a networked libSQL URL needs the adapter.
  if (!url || /^file:/i.test(url)) return new PrismaClient();

  return new PrismaClient({
    adapter: new PrismaLibSQL({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    }),
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
