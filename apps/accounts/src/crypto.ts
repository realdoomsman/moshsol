import { createCipheriv, createDecipheriv, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM for wallet secret keys at rest. A record is `iv (12) ‖ tag (16) ‖ ciphertext` with a
 * random IV per record, stored next to the id of the key that sealed it (for future rotation). The
 * wallet address is bound as additional authenticated data, so a record copied onto another user's
 * row fails to open.
 */
export class WalletCipher {
  /** Non-secret fingerprint of the master key (HMAC of a constant), stored with every record. */
  readonly keyId: string;

  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("wallet master key must be 32 bytes");
    this.keyId = createHmac("sha256", key).update("holdfast:wallet-key-id:v1").digest("hex").slice(0, 16);
  }

  seal(secret: Uint8Array, address: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(address, "utf8"));
    const ct = Buffer.concat([cipher.update(secret), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]);
  }

  /** Throws when the record was sealed under another key, was modified, or belongs to another address. */
  open(record: Uint8Array, keyId: string, address: string): Buffer {
    if (keyId !== this.keyId) throw new Error(`wallet record sealed with key ${keyId}, current key is ${this.keyId}`);
    const buf = Buffer.from(record);
    if (buf.length <= IV_BYTES + TAG_BYTES) throw new Error("wallet record is truncated");
    const decipher = createDecipheriv("aes-256-gcm", this.key, buf.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(address, "utf8"));
    decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
  }
}

/** Keyed hash for values stored as lookup keys (session ids, OAuth states): a DB leak yields no usable token. */
export function keyedHash(secret: Buffer, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(`${purpose}\n${value}`).digest("hex");
}

/** 256-bit random token, base64url. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Ed25519 signature of `message` with a 64-byte Solana secret key (seed ‖ public key). */
export function ed25519Sign(secretKey: Uint8Array, message: Uint8Array): Buffer {
  const key = createPrivateKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      d: Buffer.from(secretKey.subarray(0, 32)).toString("base64url"),
      x: Buffer.from(secretKey.subarray(32, 64)).toString("base64url"),
    },
    format: "jwk",
  });
  return sign(null, message, key);
}
