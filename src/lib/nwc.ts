import { createWalletClient } from "./wallet";

const NWC_TIMEOUT_MS = 15_000;

interface InvoiceResult {
  bolt11: string;
  paymentHash: string;
}

interface PaymentStatus {
  settled: boolean;
  preimage: string | null;
}

interface ReleaseResult {
  preimage: string;
  paidInvoice: string;
}

/** Values of LNURL_PROXY_URL that mean "do not use a proxy at all". */
const PROXY_DISABLED_VALUES = new Set(["false", "off", "none", "direct"]);

/**
 * How to resolve a vendor Lightning Address:
 *   unset            -> lightning-tools' default (Alby's public LNURL proxy)
 *   "false"/"direct" -> resolve against the vendor's own domain, no third party
 *   a URL            -> use that proxy
 */
export function getLightningAddressOptions(): { proxy?: string | false } | undefined {
  const configured = process.env.LNURL_PROXY_URL?.trim();
  if (!configured) return undefined;
  if (PROXY_DISABLED_VALUES.has(configured.toLowerCase())) return { proxy: false };
  return { proxy: configured };
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), NWC_TIMEOUT_MS);
  });
  // Clear the timer on both outcomes so a fast call doesn't pin the event loop
  // for the rest of the timeout window.
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Create a Lightning invoice via NWC (NIP-47 makeInvoice).
 */
export async function createPoolInvoice(
  nwcUrl: string,
  amountSats: number,
  memo: string
): Promise<InvoiceResult> {
  const client = createWalletClient(nwcUrl);

  try {
    const result = await withTimeout(
      client.makeInvoice({
        amount: amountSats * 1000, // NWC expects millisats
        description: memo,
      }),
      "NWC makeInvoice timed out"
    );

    return {
      bolt11: result.invoice,
      paymentHash: result.payment_hash,
    };
  } finally {
    client.close();
  }
}

/**
 * Check if an invoice has been paid via NWC (NIP-47 lookupInvoice).
 */
export async function checkInvoicePaid(
  nwcUrl: string,
  paymentHash: string
): Promise<PaymentStatus> {
  const client = createWalletClient(nwcUrl);

  try {
    const tx = await withTimeout(
      client.lookupInvoice({ payment_hash: paymentHash }),
      "NWC lookupInvoice timed out"
    );

    return {
      settled: Boolean(tx.settled_at),
      preimage: tx.preimage ?? null,
    };
  } finally {
    client.close();
  }
}

/**
 * Resolve a vendor Lightning Address into an invoice (LNURL-pay). No money moves
 * here, which is what lets the caller record the payment hash before paying.
 */
export async function requestVendorInvoice(
  vendorLnAddress: string,
  amountSats: number,
  memo: string
): Promise<{ paymentRequest: string; paymentHash: string }> {
  // Dynamically import lightning-tools (ESM)
  const { LightningAddress } = await import("@getalby/lightning-tools");

  // LNURL_PROXY_URL points the resolver at the local mock wallet in tests, at
  // your own proxy in production, or at the vendor's domain directly.
  const ln = new LightningAddress(vendorLnAddress, getLightningAddressOptions());

  // A vendor's LNURL server can hang just like a relay can, and this call sits
  // in front of the payout, so it gets the same deadline as every NWC call.
  await withTimeout(ln.fetch(), "Vendor LNURL lookup timed out");

  const invoice = await withTimeout(
    ln.requestInvoice({
      satoshi: amountSats,
      comment: memo,
    }),
    "Vendor invoice request timed out"
  );

  if (!invoice.paymentHash) {
    throw new Error("Vendor invoice did not include a payment hash");
  }

  return {
    paymentRequest: invoice.paymentRequest,
    paymentHash: invoice.paymentHash,
  };
}

/**
 * Pay an already-resolved invoice via NWC (NIP-47 payInvoice).
 */
export async function payVendorInvoice(
  nwcUrl: string,
  paymentRequest: string
): Promise<{ preimage: string }> {
  const client = createWalletClient(nwcUrl);

  try {
    const res = await withTimeout(
      client.payInvoice({ invoice: paymentRequest }),
      "NWC payInvoice timed out"
    );

    return { preimage: res.preimage };
  } finally {
    client.close();
  }
}

/**
 * Release pool funds to vendor via LNURL-pay + NWC payInvoice, in one call.
 * Prefer requestVendorInvoice + payVendorInvoice where the hash must be recorded.
 */
export async function releasePoolFunds(
  nwcUrl: string,
  vendorLnAddress: string,
  amountSats: number,
  memo: string
): Promise<ReleaseResult> {
  const invoice = await requestVendorInvoice(vendorLnAddress, amountSats, memo);
  const { preimage } = await payVendorInvoice(nwcUrl, invoice.paymentRequest);

  return { preimage, paidInvoice: invoice.paymentRequest };
}
