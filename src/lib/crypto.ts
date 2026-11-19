import crypto from "crypto";
import { resolveDatabaseTarget } from "./database-url";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let warnedAboutDerivedKey = false;

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (secret) {
    if (secret.length !== 64 || !/^[0-9a-fA-F]+$/.test(secret)) {
      throw new Error(
        "ENCRYPTION_SECRET must be exactly 64 hex characters (32 bytes)."
      );
    }
    return Buffer.from(secret, "hex");
  }

  // A deployment without ENCRYPTION_SECRET still has to encrypt and decrypt
  // consistently, so derive one key from the database URL it already has
  // instead of refusing to work. Set ENCRYPTION_SECRET when the values must
  // survive losing that configuration; see the README.
  const target = resolveDatabaseTarget();
  if (!target.url) {
    throw new Error(
      "ENCRYPTION_SECRET is not set and there is no database URL to derive a key from. " +
        "Provide a 64-character hex string (32 bytes)."
    );
  }

  if (!warnedAboutDerivedKey) {
    warnedAboutDerivedKey = true;
    console.warn(
      "[crypto] ENCRYPTION_SECRET is not set; deriving the AES key from the database URL."
    );
  }

  return crypto
    .createHash("sha256")
    .update(`kobosplit:nwc-encryption:${target.url}`)
    .digest();
}

/**
 * Organizer key: a bearer token handed out once when a pool is created. Only its
 * sha256 is stored, so the database never contains the credential itself.
 */
export function generateOrganizerToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** sha256 of a UTF-8 string (used for organizer keys). */
export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** sha256 of a preimage's raw bytes (used to verify Lightning payout proofs). */
export function sha256Preimage(preimageHex: string): string {
  return crypto.createHash("sha256").update(Buffer.from(preimageHex, "hex")).digest("hex");
}

/** Constant-time comparison of a presented organizer key against the stored hash. */
export function verifyOrganizerToken(
  token: string,
  storedHash: string | null | undefined
): boolean {
  if (!token || !storedHash) return false;
  const candidate = Buffer.from(sha256Hex(token), "hex");
  const expected = Buffer.from(storedHash, "hex");
  if (expected.length !== candidate.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

/**
 * Encrypt an NWC URI using AES-256-GCM.
 * Output format: ivHex:authTagHex:cipherTextHex
 * Raw URIs are NEVER logged.
 */
export function encryptNwcUri(plainUri: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainUri, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt an NWC URI from AES-256-GCM ciphertext.
 * Input format: ivHex:authTagHex:cipherTextHex
 * Decrypted URIs are NEVER logged.
 */
export function decryptNwcUri(encryptedPayload: string): string {
  const key = getKey();
  const parts = encryptedPayload.split(":");

  if (parts.length !== 3) {
    throw new Error(
      "Invalid encrypted payload format. Expected ivHex:authTagHex:cipherTextHex"
    );
  }

  const [ivHex, authTagHex, cipherTextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(
      `Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`
    );
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherTextHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
