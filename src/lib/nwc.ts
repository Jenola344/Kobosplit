import { nwc } from "@getalby/sdk";

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

/**
 * Create a Lightning invoice via NWC (NIP-47 makeInvoice).
 */
export async function createPoolInvoice(
  nwcUrl: string,
  amountSats: number,
  memo: string
): Promise<InvoiceResult> {
  const client = new nwc.NWCClient({ nostrWalletConnectUrl: nwcUrl });

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("NWC makeInvoice timed out")),
        NWC_TIMEOUT_MS
      )
    );

    const invoicePromise = client.makeInvoice({
      amount: amountSats * 1000, // NWC expects millisats
      description: memo,
    });

    const result = await Promise.race([invoicePromise, timeoutPromise]);

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
  const client = new nwc.NWCClient({ nostrWalletConnectUrl: nwcUrl });

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("NWC lookupInvoice timed out")),
        NWC_TIMEOUT_MS
      )
    );

    const lookupPromise = client.lookupInvoice({
      payment_hash: paymentHash,
    });

    const tx = await Promise.race([lookupPromise, timeoutPromise]);

    return {
      settled: Boolean(tx.settled_at),
      preimage: tx.preimage ?? null,
    };
  } finally {
    client.close();
  }
}

/**
 * Release pool funds to vendor via LNURL-pay + NWC payInvoice.
 */
export async function releasePoolFunds(
  nwcUrl: string,
  vendorLnAddress: string,
  amountSats: number,
  memo: string
): Promise<ReleaseResult> {
  // Dynamically import lightning-tools (ESM)
  const { LightningAddress } = await import("@getalby/lightning-tools");

  const ln = new LightningAddress(vendorLnAddress);
  await ln.fetch();

  const invoice = await ln.requestInvoice({
    satoshi: amountSats,
    comment: memo,
  });

  const client = new nwc.NWCClient({ nostrWalletConnectUrl: nwcUrl });

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("NWC payInvoice timed out")),
        NWC_TIMEOUT_MS
      )
    );

    const payPromise = client.payInvoice({
      invoice: invoice.paymentRequest,
    });

    const res = await Promise.race([payPromise, timeoutPromise]);

    return {
      preimage: res.preimage,
      paidInvoice: invoice.paymentRequest,
    };
  } finally {
    client.close();
  }
}
