/**
 * Minimal BOLT11 encoder used only by the local mock wallet harness.
 *
 * Why this exists: the app passes vendor invoices through the real
 * `@getalby/lightning-tools` decoder (`new Invoice({ pr })`), which validates
 * the bech32 checksum and reads the amount + payment hash sections. To exercise
 * that real decoding without a Lightning node, the mock wallet has to emit a
 * structurally valid invoice. No signature is produced (this is not a payable
 * invoice and must never leave the harness).
 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATOR[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const high: number[] = [];
  const low: number[] = [];
  for (const char of hrp) {
    high.push(char.charCodeAt(0) >> 5);
    low.push(char.charCodeAt(0) & 31);
  }
  return [...high, 0, ...low];
}

function bech32Encode(hrp: string, data: number[]): string {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join("")}`;
}

/** Pack bytes into 5-bit words, zero-padding the final word (BOLT11 style). */
function toWords(bytes: Uint8Array): number[] {
  const words: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((accumulator >> bits) & 31);
    }
  }
  if (bits > 0) words.push((accumulator << (5 - bits)) & 31);
  return words;
}

function intToWords(value: number, count: number): number[] {
  const words = new Array<number>(count).fill(0);
  let remaining = value;
  for (let i = count - 1; i >= 0; i--) {
    words[i] = remaining & 31;
    remaining = Math.floor(remaining / 32);
  }
  if (remaining !== 0) throw new Error(`Value ${value} does not fit in ${count} words`);
  return words;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("Payment hash must be 32 bytes of hex");
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

/**
 * Encode a (non-payable) mainnet invoice for `sats`, carrying `paymentHashHex`.
 * Amount is expressed with the `n` (nano-BTC) multiplier so any whole sat
 * amount survives the round trip through the real decoder.
 */
export function encodeBolt11(
  sats: number,
  paymentHashHex: string,
  timestamp = Math.floor(Date.now() / 1000)
): string {
  if (!Number.isInteger(sats) || sats <= 0) {
    throw new Error("Invoice amount must be a positive whole number of sats");
  }

  const hrp = `lnbc${sats * 10}n`;
  const paymentHashWords = toWords(hexToBytes(paymentHashHex));

  const words = [
    ...intToWords(timestamp, 7),
    // tag 1 = payment_hash, then its 2-word (10 bit) length, then the 52 words
    1,
    paymentHashWords.length >> 5,
    paymentHashWords.length & 31,
    ...paymentHashWords,
    // 104 words = 65 byte signature slot (all zeroes; this invoice is unsigned)
    ...new Array<number>(104).fill(0),
  ];

  return bech32Encode(hrp, words);
}
