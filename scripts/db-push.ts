/**
 * Provisions the hosted database during a deploy.
 *
 * `next build` runs it with --seed-if-empty --tolerant so a deployment sets up
 * its own database and never fails because the database is unreachable; the
 * runtime reports the real problem through /api/health instead.
 *
 * Three cases, picked from the configured URL:
 *   - a `file:` path is the local database, so there is nothing to do;
 *   - Postgres: derive a Postgres copy of prisma/schema.prisma (the checked-in
 *     one targets SQLite for local development), generate the client for it and
 *     let `prisma db push` create or update the tables;
 *   - libSQL/Turso: Prisma Migrate cannot reach it over HTTP, so apply the SQL
 *     that describes the schema with the libSQL client directly.
 *
 * Manual use: npm run db:push:turso (or db:provision)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import {
  resolveDatabaseTarget,
  type DatabaseTarget,
} from "../src/lib/database-url";

const args = new Set(process.argv.slice(2));
const flag = (name: string) => args.has(`--${name}`);

const POSTGRES_SCHEMA = "prisma/postgres.generated.prisma";

function binPath(name: string): string {
  return process.platform === "win32"
    ? `node_modules\\.bin\\${name}.cmd`
    : `node_modules/.bin/${name}`;
}

function run(name: string, argv: string[], env = process.env): void {
  execFileSync(binPath(name), argv, { stdio: "inherit", env });
}

function schemaSql(): string {
  // `migrate diff` only reads the schema, but it still validates the datasource
  // env var, which rejects a libsql:// URL under the sqlite provider.
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
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: "file:./schema-diff.db" } }
  );
}

async function hasPools(client: {
  pool: { count(): Promise<number> };
}): Promise<number> {
  return client.pool.count();
}

async function seedIfEmpty(countPools: () => Promise<number>): Promise<void> {
  const count = await countPools();
  if (count > 0) {
    console.log(`[db] ${count} pool(s) already present; not seeding.`);
    return;
  }
  console.log("[db] Database is empty; seeding demo data.");
  run("tsx", ["prisma/seed.ts"]);
}

async function provisionPostgres(): Promise<void> {
  const sqliteSchema = readFileSync("prisma/schema.prisma", "utf8");
  const postgresSchema = sqliteSchema.replace(
    /provider\s*=\s*"sqlite"/,
    'provider = "postgresql"'
  );
  if (!postgresSchema.includes('provider = "postgresql"')) {
    throw new Error("could not derive the Postgres schema from prisma/schema.prisma");
  }
  writeFileSync(POSTGRES_SCHEMA, postgresSchema);

  run("prisma", ["generate", "--schema", POSTGRES_SCHEMA]);
  run("prisma", ["db", "push", "--schema", POSTGRES_SCHEMA, "--skip-generate"]);
  console.log("✅ Postgres schema is up to date");

  if (!flag("seed-if-empty")) return;

  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient();
  try {
    await seedIfEmpty(() => hasPools(client));
  } finally {
    await client.$disconnect();
  }
}

async function provisionLibsql(target: DatabaseTarget): Promise<void> {
  const url = target.url!;
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
      await seedIfEmpty(async () => {
        const counted = await client.execute("SELECT count(*) AS n FROM Pool");
        return Number(
          counted.rows[0]?.n as number | string | bigint | null | undefined
        );
      });
    }
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  const target = resolveDatabaseTarget();

  if (target.kind === "postgres") {
    await provisionPostgres();
    return;
  }

  if (target.kind === "libsql") {
    await provisionLibsql(target);
    return;
  }

  console.log(
    `[db] Nothing to provision (${
      target.source ? `${target.source} is ${target.protocol ?? "unusable"}` : "no database URL"
    }).`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (flag("tolerant")) {
    // A build must not fail because the database is briefly unreachable; the
    // runtime reports the real problem through /api/health.
    console.error(`[db] Provisioning skipped: ${message}`);
    return;
  }
  console.error("Database provisioning failed:", error);
  process.exit(1);
});
