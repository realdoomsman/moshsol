// Runs before any app code in the browser. @solana/web3.js, Anchor and the SDK's PDA helpers
// expect Node's global `Buffer`.
import { Buffer } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  Object.assign(globalThis, { Buffer });
}
