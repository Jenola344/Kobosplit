import crypto from "crypto";
// Same client the app uses, so seeding a hosted database works too.
import { prisma } from "../src/lib/db";
// Same encryption the app uses, including its key fallback when a deployment
// has no ENCRYPTION_SECRET configured.
import { encryptNwcUri } from "../src/lib/crypto";

/**
 * Seed contributions need real proofs: sha256(preimage) must equal paymentHash,
 * otherwise every receipt on the demo pools would (correctly) fail the audit
 * check shown in the UI.
 */
function seedProof(seed: string): { preimage: string; paymentHash: string } {
  const preimage = crypto
    .createHash("sha256")
    .update(`kobosplit-seed-preimage:${seed}`)
    .digest("hex");
  const paymentHash = crypto
    .createHash("sha256")
    .update(Buffer.from(preimage, "hex"))
    .digest("hex");
  return { preimage, paymentHash };
}

async function main() {
  console.log("🌱 Seeding KoboSplit database...\n");

  // Use demo URI or a placeholder
  const demoNwcUri =
    process.env.DEMO_NWC_URI ||
    "nostr+walletconnect://demo-relay?relay=wss://relay.getalby.com/v1&secret=demo-seed-placeholder";

  const encryptedUri = encryptNwcUri(demoNwcUri);

  // Rebuild the demo ledger from scratch so old placeholder proofs can't linger.
  const removed = await prisma.contribution.deleteMany({
    where: { id: { startsWith: "seed-contrib-" } },
  });
  if (removed.count > 0) {
    console.log(`🧹 Removed ${removed.count} stale seed contributions`);
  }

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
  const chinedu = seedProof("chinedu-8000");
  await prisma.contribution.create({
    data: {
      id: "seed-contrib-001",
      poolId: pool1.id,
      nickname: "Chinedu",
      amountSats: 8000,
      paymentHash: chinedu.paymentHash,
      bolt11: "lnbc80u1pjseedexample1",
      preimage: chinedu.preimage,
      status: "PAID",
    },
  });

  const amina = seedProof("amina-7000");
  await prisma.contribution.create({
    data: {
      id: "seed-contrib-002",
      poolId: pool1.id,
      nickname: "Amina",
      amountSats: 7000,
      paymentHash: amina.paymentHash,
      bolt11: "lnbc70u1pjseedexample2",
      preimage: amina.preimage,
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
    { id: "seed-contrib-003", nickname: "Fatou", amountSats: 12000 },
    { id: "seed-contrib-004", nickname: "Moussa", amountSats: 10000 },
    { id: "seed-contrib-005", nickname: "Awa", amountSats: 10000 },
    { id: "seed-contrib-006", nickname: "Ibrahima", amountSats: 8000 },
  ];

  for (const c of pool2Contribs) {
    const proof = seedProof(`${c.id.toLowerCase()}-${c.amountSats}`);
    await prisma.contribution.create({
      data: {
        id: c.id,
        poolId: pool2.id,
        nickname: c.nickname,
        amountSats: c.amountSats,
        paymentHash: proof.paymentHash,
        bolt11: `lnbc${c.amountSats}u1pjseedexample${c.id}`,
        preimage: proof.preimage,
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
