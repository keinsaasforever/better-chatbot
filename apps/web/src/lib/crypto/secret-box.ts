import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * AES-256-GCM sealing for credentials stored at rest (cockpit connections).
 *
 * Format: base64(iv[12] | tag[16] | ciphertext). The key is `APP_SECRETS_KEY`,
 * 32 bytes encoded as base64 (`openssl rand -base64 32`).
 *
 * Without it, production derives the key from `BETTER_AUTH_SECRET` (HKDF), so
 * a one-click deploy that sets only that secret can still store connections.
 * The cost: rotating `BETTER_AUTH_SECRET` then makes stored connections
 * unreadable. With neither, production refuses to seal or open anything.
 * Development and tests fall back to a fixed, publicly known key with a
 * warning, so a local checkout works out of the box; never rely on that key
 * for real secrets.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEV_KEY = Buffer.alloc(32, "navigator-dev-only-secret-box-key");
// Domain separation: the derived key is useless for anything Better Auth does
// with the same secret, and a future key version can change this label.
const DERIVED_KEY_INFO = "navigator/secret-box/v1";

export class SecretBoxUnavailableError extends Error {
  constructor() {
    super(
      "APP_SECRETS_KEY is not set or is not 32 bytes of base64, and there is no BETTER_AUTH_SECRET to derive one from",
    );
    this.name = "SecretBoxUnavailableError";
  }
}

let warned = false;

function resolveKey(): Buffer {
  const raw = process.env.APP_SECRETS_KEY?.trim();
  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) return key;
    throw new SecretBoxUnavailableError();
  }
  if (process.env.NODE_ENV === "production") {
    const authSecret = process.env.BETTER_AUTH_SECRET?.trim();
    if (!authSecret) throw new SecretBoxUnavailableError();
    return Buffer.from(
      hkdfSync("sha256", authSecret, Buffer.alloc(0), DERIVED_KEY_INFO, 32),
    );
  }
  if (!warned) {
    warned = true;
    console.warn(
      "[secret-box] APP_SECRETS_KEY not set; using the development key. Cockpit connections are not protected at rest.",
    );
  }
  return DEV_KEY;
}

/** True when secrets can be sealed and opened in this environment. */
export function isSecretBoxAvailable(): boolean {
  try {
    resolveKey();
    return true;
  } catch {
    return false;
  }
}

export function seal(value: unknown): string {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64",
  );
}

/**
 * Decrypts a sealed value. Throws on a wrong key or a tampered payload; the
 * error never contains the plaintext.
 */
export function open<T = unknown>(sealed: string): T {
  const key = resolveKey();
  const buf = Buffer.from(sealed, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error("sealed value is too short");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as T;
}
