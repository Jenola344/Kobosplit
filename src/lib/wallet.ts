import { nwc } from "@getalby/sdk";

/**
 * The single seam between KoboSplit and a Lightning wallet.
 *
 * In production this wraps `@getalby/sdk`'s NWCClient (NIP-47 over a Nostr
 * relay). With NWC_MOCK=1 it talks to the local mock wallet in ./harness
 * instead, which is what lets the contribute → verify → release lifecycle be
 * tested end to end without a real wallet or relay.
 */

export interface WalletInvoiceResult {
  invoice: string;
  payment_hash: string;
}

export interface WalletTransaction {
  settled_at?: number;
  preimage?: string | null;
}

export interface WalletPaymentResult {
  preimage: string;
}

export interface WalletClient {
  makeInvoice(args: { amount: number; description?: string }): Promise<WalletInvoiceResult>;
  lookupInvoice(args: { payment_hash: string }): Promise<WalletTransaction>;
  payInvoice(args: { invoice: string }): Promise<WalletPaymentResult>;
  close(): void;
}

export function isMockWalletEnabled(): boolean {
  return process.env.NWC_MOCK === "1";
}

function createNwcWalletClient(nwcUrl: string): WalletClient {
  const client = new nwc.NWCClient({ nostrWalletConnectUrl: nwcUrl });

  return {
    makeInvoice: (args) => client.makeInvoice(args),
    lookupInvoice: (args) => client.lookupInvoice(args),
    payInvoice: (args) => client.payInvoice(args),
    close: () => client.close(),
  };
}

function createMockWalletClient(baseUrl: string): WalletClient {
  async function call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      throw new Error(
        `Mock wallet ${path} failed (HTTP ${res.status}): ${data?.error ?? "no response body"}. ` +
          `Is it running? Start it with: npm run mock:wallet`
      );
    }
    return data as T;
  }

  return {
    makeInvoice: (args) =>
      call<WalletInvoiceResult>("/nwc/make_invoice", {
        amount: args.amount,
        description: args.description,
      }),
    lookupInvoice: (args) => call<WalletTransaction>("/nwc/lookup_invoice", { payment_hash: args.payment_hash }),
    payInvoice: (args) => call<WalletPaymentResult>("/nwc/pay_invoice", { invoice: args.invoice }),
    close: () => {},
  };
}

export function createWalletClient(nwcUrl: string): WalletClient {
  if (isMockWalletEnabled()) {
    // A mocked wallet would report escrow payments as successful without money
    // moving, so never allow it in a production build.
    if (process.env.NODE_ENV === "production") {
      throw new Error("NWC_MOCK=1 is not allowed in production. Unset it to use a real wallet.");
    }
    return createMockWalletClient(process.env.MOCK_WALLET_URL ?? "http://127.0.0.1:3101");
  }

  return createNwcWalletClient(nwcUrl);
}
