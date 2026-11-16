import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_SECRET is not set. Provide a 64-character hex string (32 bytes)."
    );
  }
  if (secret.length !== 64 || !/^[0-9a-fA-F]+$/.test(secret)) {
    throw new Error(
      "ENCRYPTION_SECRET must be exactly 64 hex characters (32 bytes)."
    );
  }
  return Buffer.from(secret, "hex");
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
