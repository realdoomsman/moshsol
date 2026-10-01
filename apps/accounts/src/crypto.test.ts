import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { WalletCipher } from "./crypto";

const cipher = new WalletCipher(randomBytes(32));
const wallet = Keypair.generate();
const address = wallet.publicKey.toBase58();

test("a sealed wallet secret opens to the same bytes, under a fresh IV each time", () => {
  const a = cipher.seal(wallet.secretKey, address);
  const b = cipher.seal(wallet.secretKey, address);
  assert.notDeepEqual(a.subarray(0, 12), b.subarray(0, 12));
  assert.deepEqual(new Uint8Array(cipher.open(a, cipher.keyId, address)), wallet.secretKey);
  assert.deepEqual(new Uint8Array(cipher.open(b, cipher.keyId, address)), wallet.secretKey);
});

test("any modified byte of a sealed record fails authentication", () => {
  const record = cipher.seal(wallet.secretKey, address);
  for (const at of [0, 12, 28, record.length - 1]) {
    const tampered = Buffer.from(record);
    tampered[at] ^= 0x01;
    assert.throws(() => cipher.open(tampered, cipher.keyId, address), `byte ${at} flipped`);
  }
});

test("a record moved to another address or opened under another key is refused", () => {
  const record = cipher.seal(wallet.secretKey, address);
  assert.throws(() => cipher.open(record, cipher.keyId, Keypair.generate().publicKey.toBase58()));
  const other = new WalletCipher(randomBytes(32));
  assert.notEqual(other.keyId, cipher.keyId);
  assert.throws(() => other.open(record, cipher.keyId, address), /sealed with key/);
});
