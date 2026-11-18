/**
 * End-to-end harness: drives the real KoboSplit HTTP API through the whole
 * money lifecycle against a local mock wallet — no Lightning wallet, relay or
 * network access required.
 *
 * What is real here:
 *   - Next.js route handlers, Zod validation, rate limiting
 *   - Prisma/SQLite writes and the OPEN → FUNDED → RELEASED state machine
 *   - AES-256-GCM decryption of the stored NWC URI
 *   - @getalby/lightning-tools LNURL-pay resolution + BOLT11 decoding
 *   - sha256(preimage) == payment_hash for every receipt it checks
 *
 * What is mocked (see ./mock-wallet.ts):
 *   - the NIP-47 wallet itself (makeInvoice / lookupInvoice / payInvoice), so
 *     no Nostr relay is involved
 *   - the LNURL-pay proxy that resolves the vendor's Lightning Address
 *
 * Run: npm run e2e
 */

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { decodeInvoice } from "@getalby/lightning-tools";
import { PrismaClient } from "@prisma/client";

const APP_PORT = 3100;
const MOCK_PORT = 3102;

const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const WALLET_URL = `http://127.0.0.1:${MOCK_PORT}`;

// The harness uses its own database so demo/seed data in prisma/dev.db is untouched.
const HARNESS_DB = "file:./harness.db";
const HARNESS_DB_PATH = "prisma/harness.db";

const children: ChildProcess[] = [];
let db: PrismaClient;
let checks = 0;
let failures = 0;
let stopping = false;

// ── process plumbing ──────────────────────────────────────────────────────────

function launch(name: string, command: string, args: string[], env: Record<string, string>) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  const logs: string[] = [];
  const collect = (chunk: Buffer) => {
    logs.push(String(chunk));
    if (logs.length > 500) logs.splice(0, logs.length - 500);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  child.on("exit", (code) => {
    if (!stopping && code !== 0) {
      console.error(`\n[${name}] exited with code ${code}. Last output:\n${logs.slice(-25).join("")}`);
    }
  });

  children.push(child);
  return { child, logs };
}

function stopAll(): void {
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    try {
      process.kill(-child.pid, "SIGTERM"); // kill the whole process group
    } catch {
      // already gone
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(url: string, timeoutMs = 120_000, label = url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// ── HTTP + assertion helpers ──────────────────────────────────────────────────

type Json = any;

async function call(
  base: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  let body: Json = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function check(label: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    checks += 1;
    console.log(`  ✅ ${label}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ❌ ${label}`);
    console.log(`     ${message.split("\n")[0]}`);
  }
}

const sha256 = (hex: string) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");

function decode(bolt11: string) {
  const decoded = decodeInvoice(bolt11) as
    | { paymentHash?: string; satoshi?: number; description?: string }
    | null;
  assert.ok(decoded, `bolt11 could not be decoded: ${bolt11.slice(0, 24)}…`);
  return decoded;
}

async function walletState(): Promise<{
  invoices: Array<{ paymentHash: string; preimage: string | null; msat: number; sats: number; description: string; settledAt: number | null }>;
  payouts: Array<{ paymentHash: string; invoice: string; preimage: string; sats: number; description: string; paidAt: number }>;
}> {
  const res = await call(WALLET_URL, "/_state");
  assert.equal(res.status, 200, "mock wallet state should be readable");
  return res.body;
}

async function contribute(poolId: string, nickname: string, amountSats: number) {
  return call(APP_URL, `/api/pools/${poolId}/contribute`, {
    method: "POST",
    body: { nickname, amountSats },
  });
}

async function verify(poolId: string, paymentHash: string) {
  return call(APP_URL, `/api/pools/${poolId}/verify`, {
    method: "POST",
    body: { paymentHash },
  });
}

async function payContribution(paymentHash: string) {
  return call(WALLET_URL, "/dev/pay", { method: "POST", body: { payment_hash: paymentHash } });
}

async function poolDetail(poolId: string) {
  return call(APP_URL, `/api/pools/${poolId}`);
}

async function reconcile(poolId: string, organizerToken: string, preimage?: string) {
  return call(APP_URL, `/api/pools/${poolId}/reconcile`, {
    method: "POST",
    body: { organizerToken, ...(preimage ? { preimage } : {}) },
  });
}

// ── scenario ──────────────────────────────────────────────────────────────────

async function runScenario(): Promise<void> {
  console.log("\n🏦 Pool A — funded and released (contribute → verify → release)");

  const created = await call(APP_URL, "/api/pools", {
    method: "POST",
    body: {
      title: "Harness Hostel Fuel Split",
      description: "End-to-end harness pool",
      targetSats: 10_000,
      fiatCurrency: "XOF",
      vendorLnAddress: "mama-put@blink.sv",
      useDemoWallet: true,
    },
  });

  const poolA: string = created.body?.id;
  const poolAOrganizerKey = created.body?.organizerToken as string;
  await check("pool is created with the demo wallet", () => {
    assert.equal(created.status, 201, `expected 201, got ${created.status}: ${JSON.stringify(created.body)}`);
    assert.ok(poolA, "response should include the pool id");
  });

  await check("creation response leaks neither the NWC URI nor its ciphertext", () => {
    const serialised = JSON.stringify(created.body);
    assert.ok(!serialised.includes("nostr+walletconnect"), "NWC URI appeared in the response");
    assert.ok(!("encryptedNwcUri" in (created.body ?? {})), "ciphertext appeared in the response");
  });

  // Contribution 1 — partial funding
  const first = await contribute(poolA, "Tunde_04", 6_000);
  let firstHash = "";
  await check("contributing 6,000 sats returns a real BOLT11 invoice", () => {
    assert.equal(first.status, 201, JSON.stringify(first.body));
    firstHash = first.body.paymentHash;
    const decoded = decode(first.body.bolt11);
    assert.equal(decoded.satoshi, 6_000, "invoice amount should be 6,000 sats");
    assert.equal(decoded.paymentHash, firstHash, "decoded payment hash should match the API response");
    assert.ok(/^lnbc/.test(first.body.bolt11), "invoice should be a mainnet payment request");
  });

  await check("mock wallet recorded the invoice with the right memo and amount", async () => {
    const state = await walletState();
    const invoice = state.invoices.find((i) => i.paymentHash === firstHash);
    assert.ok(invoice, "invoice missing from mock wallet");
    assert.equal(invoice.msat, 6_000_000, "NWC make_invoice should be called with millisats");
    assert.ok(invoice.description.includes("Tunde_04"), `description was: ${invoice.description}`);
    assert.ok(invoice.description.includes("Harness Hostel Fuel Split"), "memo should name the pool");
  });

  await check("verified receipt is NOT issued before the invoice is paid", async () => {
    const res = await verify(poolA, firstHash);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.settled, false, "unpaid invoice must not verify as settled");
    assert.equal(res.body.preimage, null);
  });

  let firstPreimage = "";
  await check("paying the invoice makes the preimage hash to the payment hash", async () => {
    const paid = await payContribution(firstHash);
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    firstPreimage = paid.body.preimage;
    assert.equal(sha256(firstPreimage), firstHash, "preimage must be the sha256 preimage of the hash");
  });

  await check("lookupInvoice confirms settlement and locks the preimage onto the ledger", async () => {
    const res = await verify(poolA, firstHash);
    assert.equal(res.body.settled, true, JSON.stringify(res.body));
    assert.equal(res.body.preimage, firstPreimage);
    assert.equal(res.body.poolStatus, "OPEN", "pool should stay OPEN below target");
  });

  await check("pool detail shows the contribution with a receipt id", async () => {
    const res = await poolDetail(poolA);
    assert.equal(res.status, 200);
    assert.equal(res.body.collectedSats, 6_000);
    assert.equal(res.body.status, "OPEN");
    assert.equal(res.body.contributions.length, 1);
    assert.ok(res.body.contributions[0].receiptId, "contribution should expose a receipt id");
    const serialised = JSON.stringify(res.body);
    assert.ok(!serialised.includes("nostr+walletconnect"), "NWC URI leaked from the pool endpoint");
    assert.ok(!("encryptedNwcUri" in res.body), "ciphertext leaked from the pool endpoint");
  });

  // Contribution 2 — reaches the target
  const second = await contribute(poolA, "Amina", 5_000);
  let secondHash = "";
  await check("second contribution is accepted while the pool is OPEN", () => {
    assert.equal(second.status, 201, JSON.stringify(second.body));
    secondHash = second.body.paymentHash;
    assert.equal(decode(second.body.bolt11).satoshi, 5_000);
  });

  let secondPreimage = "";
  await check("second payment settles and flips the pool to FUNDED", async () => {
    const paid = await payContribution(secondHash);
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    secondPreimage = paid.body.preimage;

    const res = await verify(poolA, secondHash);
    assert.equal(res.body.settled, true, JSON.stringify(res.body));
    assert.equal(res.body.poolStatus, "FUNDED", "pool should become FUNDED once the target is met");
  });

  await check("pool detail reports 11,000 / 10,000 sats at 100%", async () => {
    const res = await poolDetail(poolA);
    assert.equal(res.body.collectedSats, 11_000);
    assert.equal(res.body.status, "FUNDED");
    assert.equal(res.body.progress, 100);
  });

  // Release
  const payoutCountBefore = (await walletState()).payouts.length;
  const release = await call(APP_URL, `/api/pools/${poolA}/release`, {
    method: "POST",
    body: { confirm: true },
  });

  let releasePreimage = "";
  await check("release pays the vendor through LNURL-pay + payInvoice", async () => {
    assert.equal(release.status, 200, JSON.stringify(release.body));
    assert.equal(release.body.status, "RELEASED");
    assert.equal(release.body.totalReleasedSats, 11_000, "the whole collected amount should be released");
    assert.equal(release.body.vendorLnAddress, "mama-put@blink.sv");
    releasePreimage = release.body.releasePreimage;
    assert.ok(/^[0-9a-f]{64}$/.test(releasePreimage), "release proof should be a 32-byte preimage");
  });

  await check("the payout proof is cryptographically sound and matches the vendor invoice", async () => {
    const state = await walletState();
    assert.equal(state.payouts.length, payoutCountBefore + 1, "exactly one vendor payout expected");
    const payout = state.payouts[state.payouts.length - 1];

    assert.equal(payout.sats, 11_000, "vendor invoice should be for the collected amount");
    const decoded = decode(payout.invoice);
    assert.equal(decoded.satoshi, 11_000, "vendor invoice amount should survive real BOLT11 decoding");
    assert.equal(sha256(payout.preimage), decoded.paymentHash, "payout preimage must hash to the invoice hash");
    assert.equal(releasePreimage, payout.preimage, "pool ledger must store the vendor payout preimage");
    assert.ok(releasePreimage !== firstPreimage && releasePreimage !== secondPreimage, "payout proof must not reuse a contribution preimage");
    assert.ok(payout.description.includes("KoboSplit payout"), `vendor memo was: ${payout.description}`);
  });

  await check("pool detail exposes RELEASED status plus the release proof", async () => {
    const res = await poolDetail(poolA);
    assert.equal(res.body.status, "RELEASED");
    assert.equal(res.body.releasePreimage, releasePreimage);
    assert.equal(res.body.progress, 100);
  });

  console.log("\n🛡  Guards — double payout, closed pools, unfunded release");

  await check("a second release is refused", async () => {
    const res = await call(APP_URL, `/api/pools/${poolA}/release`, {
      method: "POST",
      body: { confirm: true },
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(String(res.body.error), /already/i);
  });

  await check("the wallet only ever saw one payout", async () => {
    const state = await walletState();
    assert.equal(state.payouts.length, payoutCountBefore + 1);
  });

  await check("contributions are rejected after release", async () => {
    const res = await contribute(poolA, "Late_Payer", 1_000);
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  const poolBCreation = await call(APP_URL, "/api/pools", {
    method: "POST",
    body: {
      title: "Harness Unfunded Pool",
      targetSats: 50_000,
      fiatCurrency: "NGN",
      // Slow vendor: the stale-claim check parks a release inside its window.
      vendorLnAddress: "slow@blink.sv",
      useDemoWallet: true,
    },
  });
  const poolB = poolBCreation.body?.id as string;
  const poolBOrganizerKey = poolBCreation.body?.organizerToken as string;

  await check("release is refused before the target is reached", async () => {
    const contrib = await contribute(poolB, "Chinedu", 1_000);
    assert.equal(contrib.status, 201, JSON.stringify(contrib.body));
    await payContribution(contrib.body.paymentHash);
    const verified = await verify(poolB, contrib.body.paymentHash);
    assert.equal(verified.body.poolStatus, "OPEN");

    const res = await call(APP_URL, `/api/pools/${poolB}/release`, {
      method: "POST",
      body: { confirm: true },
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(String(res.body.error), /not fully funded/i);

    const detail = await poolDetail(poolB);
    assert.equal(detail.body.status, "OPEN", "a refused release must not change pool status");
  });

  console.log("\n🚧 Vendor limits — refuses to send an amount the vendor cannot accept");

  const poolCCreation = await call(APP_URL, "/api/pools", {
    method: "POST",
    body: {
      title: "Harness Tight Limit Pool",
      targetSats: 3_000,
      fiatCurrency: "XOF",
      vendorLnAddress: "tight-limit@blink.sv",
      useDemoWallet: true,
    },
  });
  const poolC = poolCCreation.body?.id as string;
  const poolCOrganizerKey = poolCCreation.body?.organizerToken as string;

  await check("a release above the vendor's LNURL maxSendable fails, rolls the claim back and moves no funds", async () => {
    const contrib = await contribute(poolC, "Awa", 3_000);
    assert.equal(contrib.status, 201, JSON.stringify(contrib.body));
    await payContribution(contrib.body.paymentHash);
    const verified = await verify(poolC, contrib.body.paymentHash);
    assert.equal(verified.body.poolStatus, "FUNDED");

    const payoutsBefore = (await walletState()).payouts.length;
    const res = await call(APP_URL, `/api/pools/${poolC}/release`, {
      method: "POST",
      body: { confirm: true },
    });
    assert.equal(res.status, 500, `expected the release to fail, got ${res.status}: ${JSON.stringify(res.body)}`);

    const detail = await poolDetail(poolC);
    assert.equal(detail.body.status, "FUNDED", "a failed payout must roll the claim back to FUNDED, not leave it RELEASING");
    assert.equal(detail.body.releasePreimage, null, "no proof should be stored for a failed release");

    const payoutsAfter = (await walletState()).payouts.length;
    assert.equal(payoutsAfter, payoutsBefore, "no vendor payment should have been attempted");
  });

  console.log("\n🏁 Concurrency — two simultaneous releases, exactly one payout");

  const poolDCreation = await call(APP_URL, "/api/pools", {
    method: "POST",
    body: {
      title: "Harness Concurrent Release Pool",
      targetSats: 5_000,
      fiatCurrency: "NGN",
      // Slow vendor: keeps the winning payout in flight during the race.
      vendorLnAddress: "slow@blink.sv",
      useDemoWallet: true,
    },
  });
  const poolD = poolDCreation.body?.id as string;
  const poolDOrganizerKey = poolDCreation.body?.organizerToken as string;

  await check("a pool is funded and ready before the race", async () => {
    const contrib = await contribute(poolD, "Ibrahima", 5_000);
    assert.equal(contrib.status, 201, JSON.stringify(contrib.body));
    await payContribution(contrib.body.paymentHash);
    const verified = await verify(poolD, contrib.body.paymentHash);
    assert.equal(verified.body.poolStatus, "FUNDED", JSON.stringify(verified.body));
  });

  await check("two concurrent release requests pay the vendor exactly once", async () => {
    const payoutsBefore = (await walletState()).payouts.length;

    const [first, second] = await Promise.all([
      call(APP_URL, `/api/pools/${poolD}/release`, { method: "POST", body: { confirm: true } }),
      call(APP_URL, `/api/pools/${poolD}/release`, { method: "POST", body: { confirm: true } }),
    ]);

    const winners = [first, second].filter((res) => res.status === 200);
    assert.equal(
      winners.length,
      1,
      `exactly one request may win the payout, got ${first.status} and ${second.status}`
    );

    const loser = [first, second].find((res) => res.status !== 200);
    assert.ok(loser, "one request must be rejected");
    console.log(`     (winner: 200, loser: ${loser.status} — ${loser.body?.error ?? "no message"})`);
    // The payout is deliberately slow, so the loser must be turned away while the
    // claim is still RELEASING. A 400 would mean it only saw "already released",
    // i.e. the requests ran one after the other and nothing was actually raced.
    assert.equal(
      loser.status,
      409,
      `the losing request must hit the in-progress claim (409), got ${loser.status}: ${JSON.stringify(loser.body)}`
    );

    const state = await walletState();
    assert.equal(state.payouts.length, payoutsBefore + 1, "the vendor must be paid exactly once, not twice");

    const detail = await poolDetail(poolD);
    assert.equal(detail.body.status, "RELEASED", "pool must settle as RELEASED, not stuck in RELEASING");
    assert.equal(detail.body.releasePreimage, state.payouts[state.payouts.length - 1].preimage);
  });

  console.log("\n🧾 Reconciliation — a payout that succeeded but was never recorded");

  const racePayout = (await walletState()).payouts.at(-1);
  assert.ok(racePayout, "the race should have produced a vendor payout");

  await check("creation hands the organizer key back once, and it is never readable again", async () => {
    assert.ok(
      typeof poolDOrganizerKey === "string" && poolDOrganizerKey.length >= 16,
      "creation should return an organizer key"
    );
    assert.ok(
      !("organizerTokenHash" in (poolDCreation.body ?? {})),
      "the stored hash must not be returned"
    );
    const detail = await poolDetail(poolD);
    assert.ok(
      !JSON.stringify(detail.body).includes(poolDOrganizerKey),
      "the organizer key must never be readable back out of the API"
    );
  });

  await check("the vendor invoice hash is recorded before the payout", async () => {
    const row = await db.pool.findUnique({
      where: { id: poolD },
      select: { status: true, releasePaymentHash: true },
    });
    assert.equal(row?.status, "RELEASED");
    assert.ok(row?.releasePaymentHash, "the vendor invoice hash must be stored");
    assert.equal(
      sha256(racePayout.preimage),
      row?.releasePaymentHash,
      "the published proof must hash to the recorded invoice"
    );
  });

  await check("a crash between payout and ledger write leaves the pool reconcilable", async () => {
    // Reproduce the real failure window: vendor paid, invoice hash stored, but
    // the RELEASED write never landed.
    await db.pool.update({
      where: { id: poolD },
      data: { status: "RELEASING", releasePreimage: null },
    });

    const row = await db.pool.findUnique({
      where: { id: poolD },
      select: { status: true, releasePaymentHash: true, releasePreimage: true },
    });
    assert.equal(row?.status, "RELEASING");
    assert.equal(row?.releasePreimage, null);
    assert.ok(row?.releasePaymentHash, "the invoice hash survives the crash");
    assert.equal((await poolDetail(poolD)).body.status, "RELEASING");
  });

  await check("a stranger cannot reconcile someone else's payout", async () => {
    const res = await reconcile(poolD, "not-the-real-organizer-key-000000", racePayout.preimage);
    assert.equal(res.status, 401, JSON.stringify(res.body));
    const row = await db.pool.findUnique({ where: { id: poolD }, select: { status: true } });
    assert.equal(row?.status, "RELEASING", "a rejected attempt must not settle the pool");
  });

  await check("a preimage that does not match the vendor invoice is refused", async () => {
    const res = await reconcile(poolD, poolDOrganizerKey, "11".repeat(32));
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(String(res.body.error), /does not (hash|match)/i);
    const row = await db.pool.findUnique({
      where: { id: poolD },
      select: { status: true, releasePreimage: true },
    });
    assert.equal(row?.status, "RELEASING");
    assert.equal(row?.releasePreimage, null);
  });

  await check("the organizer key settles the pool and publishes the verified receipt", async () => {
    const res = await reconcile(poolD, poolDOrganizerKey, racePayout.preimage);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "RELEASED");
    assert.equal(res.body.releasePreimage, racePayout.preimage);

    const detail = await poolDetail(poolD);
    assert.equal(detail.body.status, "RELEASED");
    assert.equal(detail.body.releasePreimage, racePayout.preimage);

    const payoutsBefore = (await walletState()).payouts.length;
    const retry = await call(APP_URL, `/api/pools/${poolD}/release`, {
      method: "POST",
      body: { confirm: true },
    });
    assert.ok(retry.status >= 400, "a reconciled pool must never pay the vendor again");
    assert.equal((await walletState()).payouts.length, payoutsBefore, "no second payout was made");
  });

  await check("reconciliation cannot be replayed", async () => {
    const res = await reconcile(poolD, poolDOrganizerKey, racePayout.preimage);
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(String(res.body.error), /already/i);
  });

  console.log("\n↩️  Claim release — reconciling a claim under which nothing was paid");

  await check("a claim with no recorded invoice is handed back to FUNDED", async () => {
    // Crash after the claim but before the vendor invoice was written. There is
    // no payment hash, which is what proves no money can have moved.
    await db.pool.update({
      where: { id: poolC },
      data: { status: "RELEASING", releasePaymentHash: null, releasePreimage: null },
    });

    const stuck = await poolDetail(poolC);
    assert.equal(stuck.body.status, "RELEASING");
    assert.equal(stuck.body.payoutInvoiceRecorded, false, "UI must see that no invoice was recorded");

    const wrongKey = await reconcile(poolC, "not-the-real-organizer-key-000000");
    assert.equal(wrongKey.status, 401, JSON.stringify(wrongKey.body));

    const withPreimage = await reconcile(poolC, poolCOrganizerKey, "11".repeat(32));
    assert.equal(withPreimage.status, 400, JSON.stringify(withPreimage.body));
    assert.match(String(withPreimage.body.error), /cannot be verified/i);

    const untouched = await db.pool.findUnique({
      where: { id: poolC },
      select: { status: true },
    });
    assert.equal(untouched?.status, "RELEASING", "rejected attempts must not change the claim");

    const res = await reconcile(poolC, poolCOrganizerKey);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "FUNDED");
    assert.equal(res.body.claimReleased, true);

    const detail = await poolDetail(poolC);
    assert.equal(detail.body.status, "FUNDED");
    assert.equal(detail.body.releasePreimage, null);

    const row = await db.pool.findUnique({
      where: { id: poolC },
      select: { releasePaymentHash: true, releasePreimage: true },
    });
    assert.equal(row?.releasePaymentHash, null);
    assert.equal(row?.releasePreimage, null);
  });

  await check("the recovered pool can run a release again", async () => {
    // This vendor rejects the amount, so the retry fails cleanly and lands back
    // on FUNDED — proof the pool is no longer stuck in RELEASING.
    const retry = await call(APP_URL, `/api/pools/${poolC}/release`, {
      method: "POST",
      body: { confirm: true },
    });
    assert.equal(retry.status, 500, JSON.stringify(retry.body));
    assert.equal((await poolDetail(poolC)).body.status, "FUNDED");
  });

  await check("reconciling a pool that is not awaiting reconciliation is refused", async () => {
    assert.equal((await poolDetail(poolB)).body.status, "OPEN");
    const onOpen = await reconcile(poolB, poolBOrganizerKey, racePayout.preimage);
    assert.equal(onOpen.status, 400, JSON.stringify(onOpen.body));
    assert.match(String(onOpen.body.error), /not awaiting reconciliation/i);
    assert.equal((await poolDetail(poolB)).body.status, "OPEN", "an OPEN pool must not change");

    // A settled pool reports the more specific reason.
    assert.equal((await poolDetail(poolA)).body.status, "RELEASED");
    const onReleased = await reconcile(poolA, poolAOrganizerKey);
    assert.equal(onReleased.status, 400, JSON.stringify(onReleased.body));
    assert.match(String(onReleased.body.error), /already/i);
  });

  console.log("\n🥀 Stale claim — a cancelled release cannot come back to life");

  await check("a stale release cannot record a hash or pay after its claim was handed back", async () => {
    // Fund pool B so a release can actually run.
    const topUp = await contribute(poolB, "Moussa", 49_000);
    assert.equal(topUp.status, 201, JSON.stringify(topUp.body));
    await payContribution(topUp.body.paymentHash);
    const funded = await verify(poolB, topUp.body.paymentHash);
    assert.equal(funded.body.poolStatus, "FUNDED", JSON.stringify(funded.body));

    const payoutsBefore = (await walletState()).payouts.length;

    // Request A takes the claim, then stalls while the vendor invoice is generated.
    const stale = call(APP_URL, `/api/pools/${poolB}/release`, {
      method: "POST",
      body: { confirm: true },
    });

    await sleep(600);
    const claimed = await db.pool.findUnique({
      where: { id: poolB },
      select: { status: true, releaseClaimId: true, releasePaymentHash: true },
    });
    assert.equal(claimed?.status, "RELEASING", "the first request should hold the claim");
    assert.ok(claimed?.releaseClaimId, "each claim must carry an identifier");
    assert.equal(claimed?.releasePaymentHash, null, "it should still be waiting on the vendor invoice");
    const firstClaimId = claimed?.releaseClaimId;

    // The organizer hands the claim back while A is still in flight.
    const abandon = await reconcile(poolB, poolBOrganizerKey);
    assert.equal(abandon.status, 200, JSON.stringify(abandon.body));
    assert.equal(abandon.body.status, "FUNDED");

    const afterAbandon = await db.pool.findUnique({
      where: { id: poolB },
      select: { releaseClaimId: true, releasePaymentHash: true },
    });
    assert.equal(afterAbandon?.releaseClaimId, null, "abandon must clear the claim id");
    assert.equal(afterAbandon?.releasePaymentHash, null);

    // The organizer retries immediately: a brand new claim on the same pool.
    const retry = call(APP_URL, `/api/pools/${poolB}/release`, {
      method: "POST",
      body: { confirm: true },
    });
    await sleep(400);
    const reclaimed = await db.pool.findUnique({
      where: { id: poolB },
      select: { releaseClaimId: true },
    });
    assert.ok(reclaimed?.releaseClaimId, "the retry should hold a claim");
    assert.notEqual(reclaimed?.releaseClaimId, firstClaimId, "the retry must own a different claim");

    const [staleResult, retryResult] = await Promise.all([stale, retry]);

    assert.equal(
      staleResult.status,
      409,
      `the stale request must be refused, got ${staleResult.status}: ${JSON.stringify(staleResult.body)}`
    );
    assert.equal(
      retryResult.status,
      200,
      `the retry must settle the pool, got ${retryResult.status}: ${JSON.stringify(retryResult.body)}`
    );
    console.log(`     (stale: ${staleResult.status}, retry: ${retryResult.status})`);

    const payoutsAfter = (await walletState()).payouts;
    assert.equal(payoutsAfter.length, payoutsBefore + 1, "exactly one payout across the interleaving");
    assert.equal(retryResult.body.releasePreimage, payoutsAfter[payoutsAfter.length - 1].preimage);

    const detail = await poolDetail(poolB);
    assert.equal(detail.body.status, "RELEASED");
    assert.equal(detail.body.releasePreimage, retryResult.body.releasePreimage);

    const row = await db.pool.findUnique({
      where: { id: poolB },
      select: { releasePaymentHash: true },
    });
    assert.equal(
      sha256(retryResult.body.releasePreimage),
      row?.releasePaymentHash,
      "the recorded vendor invoice must be the one the retry actually paid"
    );
  });

  console.log("\n🔒 Input validation and cross-pool isolation");

  await check("markup in a nickname is rejected", async () => {
    const res = await contribute(poolB, "<script>alert(1)</script>", 1_000);
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  await check("an invalid vendor Lightning Address is rejected", async () => {
    const res = await call(APP_URL, "/api/pools", {
      method: "POST",
      body: {
        title: "Harness Bad Vendor",
        targetSats: 5_000,
        vendorLnAddress: "not-an-address",
        useDemoWallet: true,
      },
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  await check("a payment hash cannot be verified against another pool", async () => {
    const res = await verify(poolB, firstHash);
    assert.equal(res.status, 404, JSON.stringify(res.body));
  });

  console.log("\n💱 Rates — the UI can tell a live rate from an estimate");

  await check("the rates endpoint declares live vs fallback and returns a usable rate", async () => {
    const res = await call(APP_URL, "/api/rates?currency=NGN");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(typeof res.body.isFallback, "boolean", "isFallback must be a boolean");
    assert.ok(res.body.ratePerBtc > 0, "a rate must always be available");
  });

  await check("pool pages carry the rate provenance through to the client", async () => {
    const res = await poolDetail(poolA);
    assert.equal(typeof res.body.rateIsFallback, "boolean", "pool payload must expose rateIsFallback");
  });
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("⚡ KoboSplit end-to-end harness");
  console.log("   app:         " + APP_URL);
  console.log("   mock wallet: " + WALLET_URL);
  console.log("   database:    " + HARNESS_DB + "\n");

  // Fresh harness database so every run starts from an empty ledger.
  rmSync(HARNESS_DB_PATH, { force: true });
  const push = execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: HARNESS_DB },
    encoding: "utf8",
  });
  if (!push.includes("harness.db")) {
    throw new Error(`prisma db push did not target harness.db:\n${push}`);
  }
  if (!existsSync(HARNESS_DB_PATH)) {
    throw new Error(`expected ${HARNESS_DB_PATH} to be created`);
  }

  // Direct database access lets the harness reproduce crash states the HTTP API
  // can never produce on purpose (e.g. paid vendor, unrecorded receipt).
  db = new PrismaClient({ datasourceUrl: `file:${path.resolve(HARNESS_DB_PATH)}` });

  launch("mock-wallet", "npx", ["tsx", "harness/mock-wallet.ts"], {
    MOCK_WALLET_PORT: String(MOCK_PORT),
    MOCK_AUTO_SETTLE_MS: "0",
    // These delays are scoped to the mock's `slow@blink.sv` vendor only. Only the
    // concurrency and stale-claim pools use that vendor, so the rest of the suite
    // runs at full speed while those two races stay deterministic.
    MOCK_PAY_DELAY_MS: "1200",
    MOCK_LNURL_DELAY_MS: "1500",
  });
  await waitFor(`${WALLET_URL}/health`, 30_000, "mock wallet");
  console.log("✓ mock wallet up");

  launch("next", "npx", ["next", "dev", "-H", "127.0.0.1", "-p", String(APP_PORT)], {
    DATABASE_URL: HARNESS_DB,
    NWC_MOCK: "1",
    MOCK_WALLET_URL: WALLET_URL,
    LNURL_PROXY_URL: `${WALLET_URL}/lnurl`,
    DEMO_NWC_URI: "nostr+walletconnect://mock?relay=wss://mock.relay.local&secret=harness",
  });
  await waitFor(`${APP_URL}/api/pools`, 150_000, "KoboSplit dev server");
  console.log("✓ app server up\n");

  const initial = await call(APP_URL, "/api/pools");
  assert.equal(initial.body.pools.length, 0, "harness database should start empty (DATABASE_URL override failed?)");

  await runScenario();

  console.log(`\n${"─".repeat(60)}`);
  console.log(failures === 0 ? `✅ ${checks} checks passed` : `❌ ${failures} of ${checks + failures} checks failed`);
  console.log(`${"─".repeat(60)}\n`);
}

main()
  .catch((error) => {
    failures += 1;
    console.error("\n❌ Harness error:", error instanceof Error ? error.message : error);
  })
  .finally(() => {
    stopAll();
    void db?.$disconnect();
    setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
  });
