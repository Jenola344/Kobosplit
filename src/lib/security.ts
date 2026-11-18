import { z } from "zod";

// ── Zod Schemas ──

const nwcUriRegex = /^nostr\+walletconnect:\/\/.+/;
const lnAddressRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export const createPoolSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters")
    .max(100, "Title must be under 100 characters"),
  description: z.string().max(500).optional(),
  targetSats: z
    .number()
    .int()
    .min(1000, "Minimum target is 1,000 sats")
    .max(10_000_000, "Maximum target is 10,000,000 sats"),
  fiatCurrency: z.enum(["NGN", "XOF"]).default("NGN"),
  vendorLnAddress: z
    .string()
    .regex(lnAddressRegex, "Invalid Lightning Address format (user@domain)"),
  nwcUri: z
    .string()
    .regex(nwcUriRegex, "Invalid NWC URI format (nostr+walletconnect://...)")
    .optional(),
  useDemoWallet: z.boolean().default(false),
  expiresInHours: z.number().int().min(1).max(168).default(48),
});

export const contributeSchema = z.object({
  nickname: z
    .string()
    .min(1, "Nickname is required")
    .max(30, "Nickname must be under 30 characters")
    .regex(
      /^[a-zA-Z0-9_\-\s]+$/,
      "Nickname can only contain letters, numbers, spaces, hyphens, and underscores"
    ),
  amountSats: z
    .number()
    .int()
    .min(100, "Minimum contribution is 100 sats")
    .max(10_000_000, "Maximum contribution is 10,000,000 sats"),
});

export const verifySchema = z.object({
  paymentHash: z
    .string()
    .min(1, "Payment hash is required")
    .regex(/^[a-fA-F0-9]+$/, "Invalid payment hash format"),
});

export const reconcileSchema = z.object({
  organizerToken: z
    .string()
    .min(16, "Organizer key is required")
    .max(200, "Organizer key is too long"),
  // Required only when a vendor invoice was recorded before the crash; omitted
  // when the organizer is handing back a claim under which nothing was paid.
  preimage: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "Payout preimage must be 32 bytes of hex")
    .optional(),
});

export const releaseSchema = z.object({
  confirm: z.literal(true, {
    errorMap: () => ({ message: "You must confirm the release" }),
  }),
});

// ── Rate Limiter ──

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    entry.timestamps = entry.timestamps.filter(
      (ts) => now - ts < 60_000
    );
    if (entry.timestamps.length === 0) {
      rateLimitStore.delete(key);
    }
  }
}, 60_000);

/**
 * In-memory sliding-window rate limiter.
 * Keys by route + pool ID — never stores raw IPs.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  let entry = rateLimitStore.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter(
    (ts) => now - ts < windowMs
  );

  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = windowMs - (now - oldestInWindow);
    return { allowed: false, retryAfterMs };
  }

  entry.timestamps.push(now);
  return { allowed: true, retryAfterMs: 0 };
}

export type CreatePoolInput = z.infer<typeof createPoolSchema>;
export type ContributeInput = z.infer<typeof contributeSchema>;
