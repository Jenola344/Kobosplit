/**
 * Creates the schema on a hosted libSQL database (Turso).
 *
 * Prisma Migrate cannot reach libSQL over HTTP, so this asks the Prisma CLI for
 * the SQL that describes the current schema and applies it with the libSQL
 * client. It refuses to run against a database that already has tables, so it
 * can never write over an existing deployment.
 *
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:push:turso
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";

const prismaBin =
  process.platform === "win32"
    ? "node_modules\\.bin\\prisma.cmd"
    : "node_modules/.bin/prisma";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error(
      "TURSO_DATABASE_URL is required (libsql://<db>-<org>.turso.io). Use DATABASE_URL + `prisma db push` for the local file database."
    );
    process.exit(1);
  }

  const schemaSql = execFileSync(
    prismaBin,
    [
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--script",
    ],
    { encoding: "utf8" }
  );

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  try {
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );
    if (tables.rows.length > 0) {
      console.error(
        `Refusing to push: the database already has tables (${tables.rows
          .map((row) => row.name)
          .join(", ")}).`
      );
      process.exit(1);
    }

    await client.executeMultiple(schemaSql);

    const created = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    console.log(
      `✅ Schema applied to ${url}\n   tables: ${created.rows
        .map((row) => row.name)
        .join(", ")}`
    );
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error("Schema push failed:", error);
  process.exit(1);
});
