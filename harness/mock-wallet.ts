/**
 * Local mock wallet service for KoboSplit.
 *
 * Stands in for two external systems so the whole escrow lifecycle can run
 * without real money:
 *
 *  1. A NIP-47 wallet (the organizer's Alby Hub / Mutiny). The app's wallet
 *     client posts the same arguments it would send over a Nostr relay and gets
 *     the same response shapes back:
 *        POST /nwc/make_invoice   { amount (msat), description } -> { invoice, payment_hash }
 *        POST /nwc/lookup_invoice { payment_hash }               -> { settled_at?, preimage? }
 *        POST /nwc/pay_invoice    { invoice }                    -> { preimage }
 *
 *  2. The LNURL-pay proxy used to resolve a vendor Lightning Address, matching
 *     the endpoints @getalby/lightning-tools calls:
 *        GET /lnurl/lightning-address-details?ln=user@domain -> { lnurlp }
 *        GET /lnurl/generate-invoice?ln=&amount=&comment=    -> { invoice: { pr, verify } }
 *
 * Invoices are real BOLT11 structures (see ./bolt11.ts), and every preimage is
 * the actual sha256 preimage of its payment hash, so receipts can be verified
 * cryptographically rather than trusted.
 *
 * Helper endpoints for driving the demo:
 *        POST /dev/pay  { payment_hash } | { latest: true }  -> simulates the member's wallet paying
 *        GET  /_state                                        -> invoice + payout ledger
 *        GET  /health
 *
 * Run: npm run mock:wallet
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { encodeBolt11 } from "./bolt11";

const PORT = Number(process.env.MOCK_WALLET_PORT ?? 3101);
/** If > 0, incoming invoices settle on their own after this delay (demo mode). */
const AUTO_SETTLE_MS = Number(process.env.MOCK_AUTO_SETTLE_MS ?? 0);
/**
 * Delays that apply ONLY to deliberately slow vendors (see `slowVendor` below).
 * The harness sets them so races are deterministic without slowing the rest of
 * the suite: ordinary vendors always settle and generate invoices immediately.
 *
 *  - PAY_DELAY_MS: keeps a payout in flight, so a concurrent release arrives
 *    while the winner still holds its claim.
 *  - LNURL_DELAY_MS: holds a release between "claim taken" and "invoice hash
 *    recorded", the window where a stale request could otherwise come back.
 */
const PAY_DELAY_MS = Number(process.env.MOCK_PAY_DELAY_MS ?? 0);
const LNURL_DELAY_MS = Number(process.env.MOCK_LNURL_DELAY_MS ?? 0);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface MockInvoice {
  invoice: string;
  paymentHash: string;
  preimage: string;
  msat: number;
  sats: number;
  description: string;
  vendor: string | null;
  createdAt: number;
  settledAt: number | null;
}

const byPaymentHash = new Map<string, MockInvoice>();
const byInvoice = new Map<string, MockInvoice>();
const payouts: Array<{ paymentHash: string; invoice: string; preimage: string; sats: number; description: string; comment: string | null; paidAt: number }> = [];

interface MockVendor {
  minSendable: number;
  maxSendable: number;
  description: string;
  /** Deliberately slow: only this vendor is affected by the harness delays. */
  slow?: boolean;
}

const VENDOR_DEFAULTS: MockVendor = {
  minSendable: 1_000,
  maxSendable: 1_000_000_000,
  description: "Mock vendor",
};
const VENDORS: Record<string, MockVendor> = {
  "mama-put@blink.sv": {
    minSendable: 1_000,
    maxSendable: 1_000_000_000,
    description: "Mama Put — Sandaga Market catering",
  },
  // Deliberately low receive limit, used to prove the app refuses to pay an
  // amount the vendor cannot accept instead of silently sending it.
  "tight-limit@blink.sv": {
    minSendable: 1_000,
    maxSendable: 2_000_000,
    description: "Mock vendor with a tight receive limit",
  },
  // Used only by the pool(s) that need a deterministic race window.
  "slow@blink.sv": {
    minSendable: 1_000,
    maxSendable: 1_000_000_000,
    description: "Mock vendor with a slow wallet",
    slow: true,
  },
};

function vendorFor(address: string) {
  return VENDORS[address.toLowerCase()] ?? VENDOR_DEFAULTS;
}

function sha256(hex: string): string {
  return createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function createInvoice(msat: number, description: string, vendor: string | null): MockInvoice {
  if (!Number.isInteger(msat) || msat <= 0) throw new Error("amount must be a positive integer number of millisats");
  const sats = msat / 1000;
  if (!Number.isInteger(sats)) throw new Error("amount must be a whole number of sats");

  const preimage = randomBytes(32).toString("hex");
  const paymentHash = sha256(preimage);
  const invoice = encodeBolt11(sats, paymentHash);

  const record: MockInvoice = {
    invoice,
    paymentHash,
    preimage,
    msat,
    sats,
    description,
    vendor,
    createdAt: nowSeconds(),
    settledAt: null,
  };

  byPaymentHash.set(paymentHash, record);
  byInvoice.set(invoice, record);

  if (AUTO_SETTLE_MS > 0 && vendor === null) {
    setTimeout(() => settle(record), AUTO_SETTLE_MS).unref();
  }

  return record;
}

function settle(record: MockInvoice): MockInvoice {
  if (record.settledAt === null) record.settledAt = nowSeconds();
  return record;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function serialise(record: MockInvoice) {
  return {
    invoice: record.invoice,
    paymentHash: record.paymentHash,
    preimage: record.settledAt ? record.preimage : null,
    msat: record.msat,
    sats: record.sats,
    description: record.description,
    vendor: record.vendor,
    createdAt: record.createdAt,
    settledAt: record.settledAt,
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    if (route === "GET /health") {
      return json(res, 200, { ok: true, autoSettleMs: AUTO_SETTLE_MS, invoices: byPaymentHash.size });
    }

    if (route === "GET /_state") {
      return json(res, 200, {
        autoSettleMs: AUTO_SETTLE_MS,
        invoices: [...byPaymentHash.values()].map(serialise),
        payouts,
      });
    }

    // ── NIP-47 wallet surface ──
    if (route === "POST /nwc/make_invoice") {
      const body = await readBody(req);
      const amount = Number(body.amount);
      const description = typeof body.description === "string" ? body.description : "";
      const record = createInvoice(amount, description, null);
      console.log(`[mock-wallet] make_invoice ${record.sats} sats "${description}"`);
      return json(res, 200, { invoice: record.invoice, payment_hash: record.paymentHash });
    }

    if (route === "POST /nwc/lookup_invoice") {
      const body = await readBody(req);
      const paymentHash = String(body.payment_hash ?? "");
      const record = byPaymentHash.get(paymentHash);
      if (!record) return json(res, 404, { error: "invoice not found" });
      return json(res, 200, {
        type: "incoming",
        invoice: record.invoice,
        payment_hash: record.paymentHash,
        amount: record.msat,
        description: record.description,
        created_at: record.createdAt,
        ...(record.settledAt ? { settled_at: record.settledAt, preimage: record.preimage } : {}),
      });
    }

    if (route === "POST /nwc/pay_invoice") {
      const body = await readBody(req);
      const pr = String(body.invoice ?? "");
      const record = byInvoice.get(pr);
      if (!record) return json(res, 404, { error: "unknown invoice" });
      // Ordinary vendors pay immediately; only the slow vendor holds the payout.
      const paidVendor = record.vendor ? vendorFor(record.vendor) : null;
      if (paidVendor?.slow && PAY_DELAY_MS > 0) await wait(PAY_DELAY_MS);
      settle(record);
      payouts.push({
        paymentHash: record.paymentHash,
        invoice: record.invoice,
        preimage: record.preimage,
        sats: record.sats,
        description: record.description,
        comment: null,
        paidAt: record.settledAt ?? nowSeconds(),
      });
      console.log(`[mock-wallet] pay_invoice ${record.sats} sats -> ${record.vendor ?? "unknown vendor"}`);
      return json(res, 200, { preimage: record.preimage });
    }

    // ── LNURL-pay proxy surface (shapes of api.getalby.com/lnurl) ──
    if (route === "GET /lnurl/lightning-address-details") {
      const address = url.searchParams.get("ln") ?? "";
      const vendor = vendorFor(address);
      return json(res, 200, {
        lnurlp: {
          tag: "payRequest",
          callback: `http://127.0.0.1:${PORT}/lnurl/invoice`,
          minSendable: vendor.minSendable,
          maxSendable: vendor.maxSendable,
          metadata: JSON.stringify([
            ["text/plain", vendor.description],
            ["text/identifier", address],
          ]),
          commentAllowed: 200,
        },
      });
    }

    if (route === "GET /lnurl/generate-invoice") {
      const address = url.searchParams.get("ln") ?? "";
      const amountMsat = Number(url.searchParams.get("amount") ?? "0");
      const comment = url.searchParams.get("comment");
      const vendor = vendorFor(address);
      // Only the slow vendor stalls here, so a release can be caught mid-window.
      if (vendor.slow && LNURL_DELAY_MS > 0) await wait(LNURL_DELAY_MS);

      if (!Number.isInteger(amountMsat) || amountMsat < vendor.minSendable || amountMsat > vendor.maxSendable) {
        console.log(`[mock-wallet] generate-invoice rejected ${amountMsat} msat for ${address}`);
        return json(res, 400, {
          status: "ERROR",
          reason: `Amount ${amountMsat} msat is outside the vendor range ${vendor.minSendable}–${vendor.maxSendable}`,
        });
      }

      const description = comment ? `${vendor.description} — ${comment}` : vendor.description;
      const record = createInvoice(amountMsat, description, address);
      console.log(`[mock-wallet] generate-invoice ${record.sats} sats for ${address}`);
      return json(res, 200, {
        invoice: {
          pr: record.invoice,
          verify: `http://127.0.0.1:${PORT}/lnurl/verify/${record.paymentHash}`,
        },
      });
    }

    if (route.startsWith("GET /lnurl/verify/")) {
      const paymentHash = url.pathname.slice("GET /lnurl/verify/".length);
      const record = byPaymentHash.get(paymentHash);
      if (!record) return json(res, 404, { status: "ERROR", reason: "Unknown invoice" });
      return json(res, 200, {
        status: "OK",
        settled: record.settledAt !== null,
        preimage: record.settledAt ? record.preimage : null,
      });
    }

    // ── Demo driver: a member's wallet paying their share ──
    if (route === "POST /dev/pay") {
      const body = await readBody(req);
      let record: MockInvoice | undefined;

      if (body.latest === true) {
        record = [...byPaymentHash.values()]
          .filter((invoice) => invoice.settledAt === null && invoice.vendor === null)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
      } else if (typeof body.payment_hash === "string") {
        record = byPaymentHash.get(body.payment_hash);
      }

      if (!record) return json(res, 404, { error: "No matching unpaid invoice" });
      settle(record);
      console.log(`[mock-wallet] dev/pay ${record.sats} sats (${record.description})`);
      return json(res, 200, {
        paymentHash: record.paymentHash,
        preimage: record.preimage,
        sats: record.sats,
        settledAt: record.settledAt,
      });
    }

    return json(res, 404, { error: `No mock route for ${route}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[mock-wallet] ${route} failed: ${message}`);
    return json(res, 500, { error: message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[mock-wallet] listening on http://127.0.0.1:${PORT}` +
      (AUTO_SETTLE_MS > 0 ? ` (auto-settles contributions after ${AUTO_SETTLE_MS}ms)` : " (manual settle via /dev/pay)")
  );
});
