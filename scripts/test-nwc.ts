/**
 * KoboSplit NWC Integration Test Script
 *
 * Tests createPoolInvoice, checkInvoicePaid, and releasePoolFunds
 * against the DEMO_NWC_URI from .env
 *
 * Usage: npx tsx scripts/test-nwc.ts
 */

import "dotenv/config";

async function main() {
  const nwcUrl = process.env.DEMO_NWC_URI;

  if (!nwcUrl) {
    console.error(
      "❌ DEMO_NWC_URI is not set in .env\n" +
        "   Get a free testnet NWC URI from https://nwc.getalby.com\n" +
        "   and add it to your .env file."
    );
    process.exit(1);
  }

  console.log("🔌 KoboSplit NWC Integration Test\n");
  console.log("NWC URI: nostr+walletconnect://[REDACTED]\n");

  // Dynamic import to work with ESM modules
  const { createPoolInvoice, checkInvoicePaid, releasePoolFunds } =
    await import("../src/lib/nwc");

  // Test 1: Create Invoice
  console.log("━".repeat(50));
  console.log("TEST 1: Create Invoice (makeInvoice)");
  console.log("━".repeat(50));

  try {
    const invoice = await createPoolInvoice(
      nwcUrl,
      1000,
      "KoboSplit Test: 1000 sats invoice"
    );
    console.log("✅ Invoice created successfully!");
    console.log(`   Payment Hash: ${invoice.paymentHash}`);
    console.log(`   BOLT11: ${invoice.bolt11.slice(0, 40)}...`);
    console.log();

    // Test 2: Check Invoice Status
    console.log("━".repeat(50));
    console.log("TEST 2: Check Invoice Status (lookupInvoice)");
    console.log("━".repeat(50));

    const status = await checkInvoicePaid(nwcUrl, invoice.paymentHash);
    console.log(`✅ Invoice lookup successful!`);
    console.log(`   Settled: ${status.settled}`);
    console.log(`   Preimage: ${status.preimage ?? "null (not yet paid)"}`);
    console.log();
  } catch (error) {
    console.error("❌ Test failed:", error);
    console.log();
  }

  // Test 3: Release Funds (LNURL-pay)
  console.log("━".repeat(50));
  console.log("TEST 3: Release Funds (LNURL-pay + payInvoice)");
  console.log("━".repeat(50));
  console.log("⚠️  This test attempts a real payment to a Lightning Address.");
  console.log(
    "   It will only succeed on testnet/mutinynet with sufficient balance.\n"
  );

  try {
    const release = await releasePoolFunds(
      nwcUrl,
      "hello@getalby.com",
      100,
      "KoboSplit Test: Release 100 sats"
    );
    console.log("✅ Release successful!");
    console.log(`   Preimage: ${release.preimage}`);
    console.log(`   Paid Invoice: ${release.paidInvoice.slice(0, 40)}...`);
  } catch (error) {
    console.log(
      `⚠️  Release test failed (expected on testnet without balance):`
    );
    console.log(
      `   ${error instanceof Error ? error.message : String(error)}`
    );
  }

  console.log("\n🏁 Tests complete!\n");
}

main().catch(console.error);
