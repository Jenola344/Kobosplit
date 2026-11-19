/**
 * Creates (and optionally seeds) the schema on a hosted libSQL database (Turso).
 *
 * Prisma Migrate cannot reach libSQL over HTTP, so this asks the Prisma CLI for
 * the SQL that describes the current schema and applies it with the libSQL
 * client.
 *
 * `next build` runs it with --if-missing --seed-if-empty --tolerant, so a deploy
 * provisions a fresh database by itself and never fails because the database is
 * unreachable. Manual use:
 *
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:push:turso
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { resolveDatabaseTarget } from "../src/lib/database-url";

const args = new Set(process.argv.slice(2));
const flag = (name: string) => args.has(`--${name}`);

function binPath(name: string): string {
  return process.platform === "win32"
    ? `node_modules\\.bin\\${name}.cmd`
    : `node_modules/.bin/${name}`;
}

function schemaSql(): string {
  // `migrate diff` only reads the schema, but it still validates the datasource
  // env var, which rejects a libsql:// URL under the sqlite provider.
  const env = { ...process.env, DATABASE_URL: "file:./schema-diff.db" };

  return execFileSync(
    binPath("prisma"),
    [
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--script",
    ],
    { encoding: "utf8", env }
  );
}

async function main() {
  const target = resolveDatabaseTarget();
  // file: URLs are the local database; only a networked libSQL URL needs this.
  if (!target.isRemote || !target.url) {
    console.log(
      `[db] No hosted libSQL database configured (${
        target.source ? `${target.source} is ${target.protocol ?? "unusable"}` : "no database URL"
      }); nothing to provision.`
    );
    return;
  }
  const url = target.url;

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  try {
    const before = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const existing = before.rows.map((row) => String(row.name));

    if (existing.length > 0) {
      if (!flag("if-missing")) {
        console.error(
          `Refusing to push: the database already has tables (${existing.join(", ")}).`
        );
        process.exit(1);
      }
      console.log(`[db] Schema already present (${existing.join(", ")}).`);
    } else {
      await client.executeMultiple(schemaSql());
      const created = await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      );
      console.log(
        `✅ Schema applied to ${url}\n   tables: ${created.rows
          .map((row) => String(row.name))
          .join(", ")}`
      );
    }

    if (flag("seed-if-empty")) {
      const counted = await client.execute("SELECT count(*) AS n FROM Pool");
      const count = Number(
        counted.rows[0]?.n as number | string | bigint | null | undefined
      );
      if (count === 0) {
        console.log("[db] Pool table is empty; seeding demo data.");
        execFileSync(binPath("tsx"), ["prisma/seed.ts"], { stdio: "inherit" });
      } else {
        console.log(`[db] ${count} pool(s) already present; not seeding.`);
      }
    }
  } finally {
    client.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (flag("tolerant")) {
    // A build must not fail because the database is briefly unreachable; the
    // runtime reports the real problem through /api/health.
    console.error(`[db] Schema provisioning skipped: ${message}`);
    return;
  }
  console.error("Schema push failed:", error);
  process.exit(1);
});
