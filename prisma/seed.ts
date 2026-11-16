import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

// Replicate encryption logic for seed data
function encryptNwcUri(plainUri: string): string {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret || secret.length !== 64) {
    throw new Error("ENCRYPTION_SECRET must be a 64-char hex string");
  }
  const key = Buffer.from(secret, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plainUri, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

async function main() {
  console.log("🌱 Seeding KoboSplit database...\n");

  // Use demo URI or a placeholder
  const demoNwcUri =
    process.env.DEMO_NWC_URI ||
    "nostr+walletconnect://demo-relay?relay=wss://relay.getalby.com/v1&secret=demo-seed-placeholder";

  const encryptedUri = encryptNwcUri(demoNwcUri);

  // ── Pool 1: Nigerian Campus Generator Fuel Split ──
  const pool1 = await prisma.pool.upsert({
    where: { id: "seed-pool-lagos-001" },
    update: {},
    create: {
      id: "seed-pool-lagos-001",
      title: "CSC 400L Hostel Generator Fuel Split",
      description:
        "Monthly fuel contribution for Block C generator. Split among 20 hostel residents to keep lights on during PHCN outages.",
      targetSats: 25000,
      fiatCurrency: "NGN",
      vendorLnAddress: "campus-energy@getalby.com",
      status: "OPEN",
      encryptedNwcUri: encryptedUri,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  // Add 2 settled contributions for Pool 1 (15,000 of 25,000 sats)
  await prisma.contribution.upsert({
    where: { paymentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2" },
    update: {},
    create: {
      id: "seed-contrib-001",
      poolId: pool1.id,
      nickname: "Chinedu",
      amountSats: 8000,
      paymentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      bolt11: "lnbc80u1pjseedexample1",
      preimage: "e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
      status: "PAID",
    },
  });

  await prisma.contribution.upsert({
    where: { paymentHash: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3" },
    update: {},
    create: {
      id: "seed-contrib-002",
      poolId: pool1.id,
      nickname: "Amina",
      amountSats: 7000,
      paymentHash: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
      bolt11: "lnbc70u1pjseedexample2",
      preimage: "f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9",
      status: "PAID",
    },
  });

  console.log(`✅ Pool 1: "${pool1.title}" (${pool1.status}) with 2 contributions`);

  // ── Pool 2: Dakar Market Produce Bulk Buy ──
  const pool2 = await prisma.pool.upsert({
    where: { id: "seed-pool-dakar-001" },
    update: {},
    create: {
      id: "seed-pool-dakar-001",
      title: "Dakar Sandaga Market Produce Bulk Buy",
      description:
        "Group purchase of seasonal produce from Sandaga Market vendors. Bulk buying reduces per-unit cost by 30% for cooperative members.",
      targetSats: 40000,
      fiatCurrency: "XOF",
      vendorLnAddress: "sandaga-coop@getalby.com",
      status: "FUNDED",
      encryptedNwcUri: encryptedUri,
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
    },
  });

  // Add 4 settled contributions for Pool 2 (totaling 40,000 sats = fully funded)
  const pool2Contribs = [
    { id: "seed-contrib-003", nickname: "Fatou", amountSats: 12000, hashSuffix: "c3d4", preimgSuffix: "a9b0" },
    { id: "seed-contrib-004", nickname: "Moussa", amountSats: 10000, hashSuffix: "d4e5", preimgSuffix: "b0c1" },
    { id: "seed-contrib-005", nickname: "Awa", amountSats: 10000, hashSuffix: "e5f6", preimgSuffix: "c1d2" },
    { id: "seed-contrib-006", nickname: "Ibrahima", amountSats: 8000, hashSuffix: "f6a1", preimgSuffix: "d2e3" },
  ];

  for (const c of pool2Contribs) {
    const paymentHash = `${c.hashSuffix}e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6`;
    const preimage = `${c.preimgSuffix}c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2`;
    await prisma.contribution.upsert({
      where: { paymentHash },
      update: {},
      create: {
        id: c.id,
        poolId: pool2.id,
        nickname: c.nickname,
        amountSats: c.amountSats,
        paymentHash,
        bolt11: `lnbc${c.amountSats}u1pjseedexample${c.id}`,
        preimage,
        status: "PAID",
      },
    });
  }

  console.log(`✅ Pool 2: "${pool2.title}" (${pool2.status}) with 4 contributions`);
  console.log("\n🎉 Seed complete! Run `npm run dev` to start.\n");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
