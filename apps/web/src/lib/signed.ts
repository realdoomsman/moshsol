import bs58 from "bs58";

/**
 * Indexer signed writes (API.md "Signed messages"): the wallet signs a 4-line UTF-8 message
 *
 *   holdfast:<kind>:v1
 *   <subject>
 *   <sha256(payload) lowercase hex>
 *   <unix seconds>
 *
 * Signing a message costs nothing (no transaction). Every message is accepted once, so sign a
 * fresh one per request.
 */
export type SignedKind = "comment" | "profile";

export type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Builds and signs the canonical message for `payload` (hash it exactly as it is sent: the comment
 * `body`, or the profile JSON string). Returns the `message` + base58 `signature` request fields.
 */
export async function signedMessage(
  kind: SignedKind,
  subject: string,
  payload: string,
  signMessage: SignMessage,
): Promise<{ message: string; signature: string }> {
  const message = `holdfast:${kind}:v1\n${subject}\n${await sha256Hex(payload)}\n${Math.floor(Date.now() / 1000)}`;
  const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
  return { message, signature };
}
