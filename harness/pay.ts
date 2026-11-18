/**
 * Pay an invoice on the local mock wallet — the stand-in for scanning the QR
 * code with a real wallet during a demo.
 *
 * Usage:
 *   npm run mock:pay              # pay the most recent unpaid contribution invoice
 *   npm run mock:pay -- <hash>    # pay a specific payment hash
 */

const WALLET_URL = process.env.MOCK_WALLET_URL ?? "http://127.0.0.1:3101";

async function main(): Promise<void> {
  const paymentHash = process.argv[2];

  const res = await fetch(`${WALLET_URL}/dev/pay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(paymentHash ? { payment_hash: paymentHash } : { latest: true }),
  });

  const data = (await res.json().catch(() => null)) as
    | { paymentHash?: string; preimage?: string; sats?: number; error?: string }
    | null;

  if (!res.ok || !data) {
    console.error(`❌ ${data?.error ?? `Mock wallet returned HTTP ${res.status}`}`);
    console.error(`   Is the mock wallet running? Start it with: npm run mock:wallet`);
    process.exit(1);
  }

  console.log(`✅ Paid ${data.sats?.toLocaleString()} sats`);
  console.log(`   payment hash: ${data.paymentHash}`);
  console.log(`   preimage:     ${data.preimage}`);
}

main().catch((error) => {
  console.error("❌", error instanceof Error ? error.message : error);
  process.exit(1);
});
