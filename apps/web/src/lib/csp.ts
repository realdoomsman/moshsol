import { createHash } from "node:crypto";
import { NEW_HERE_BOOT_SCRIPT } from "@/components/onboarding/new-here-boot";
import { AGENT_URL, INDEXER_URL, INDEXER_WS_URL, RPC_URL, WS_URL } from "./env";
import { IMAGE_GATEWAY_HOSTS } from "./og-image";

/**
 * Hand-written inline scripts (`<script dangerouslySetInnerHTML>`), allowed by content hash: they are constants, so
 * the hash holds for every response and the markup needs no nonce. Any new inline script must be listed here.
 */
const INLINE_SCRIPT_HASHES = [NEW_HERE_BOOT_SCRIPT].map((s) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`).join(" ");

/** `scheme://host[:port]` of a configured URL (never its path or query: an RPC URL may carry an API key). */
function origin(url: string): string | null {
  try {
    const o = new URL(url).origin;
    return o === "null" ? null : o;
  } catch {
    return null;
  }
}

/** A source list: configured origins deduplicated (indexer, RPC and WS often share one), unset ones dropped. */
function sources(...xs: (string | null)[]): string {
  return [...new Set(xs.filter((x) => x !== null))].join(" ");
}

const DEV = process.env.NODE_ENV === "development";

/** Everything but scripts is fixed per build (the origins come from the inlined `NEXT_PUBLIC_*` env). */
const STATIC_DIRECTIVES = [
  "default-src 'self'",
  // React `style` attributes, sonner's injected sheet and Next's inline styles; a nonce here would disable 'unsafe-inline'.
  "style-src 'self' 'unsafe-inline'",
  // Token images and avatars: indexer uploads, the Arweave/IPFS gateways (same list the OG renderer fetches from),
  // data: for Wallet Standard icons, blob: for the create wizard's local preview. Anything else falls back to the tile.
  `img-src ${sources("'self'", "data:", "blob:", origin(INDEXER_URL), ...IMAGE_GATEWAY_HOSTS.flatMap((h) => [`https://${h}`, `https://*.${h}`]))}`,
  "font-src 'self'",
  "media-src 'self'",
  // ws://localhost:* is Mobile Wallet Adapter's local association socket (Android Chrome ↔ the installed wallet app).
  `connect-src ${sources("'self'", origin(INDEXER_URL), origin(INDEXER_WS_URL), origin(RPC_URL), origin(WS_URL), origin(AGENT_URL), "ws://localhost:*")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // No upgrade-insecure-requests: per spec it upgrades ws: to wss:, which can break Mobile Wallet Adapter's
  // ws://localhost socket; the site's own origins are https-only (HSTS) anyway.
];

/**
 * The page Content-Security-Policy for one response. Scripts run only with this request's nonce (Next stamps it on
 * its framework, chunk and inline scripts by reading it back from the request's CSP header) or a listed inline
 * hash; 'strict-dynamic' lets those load further chunks. Wallet extensions inject from their own context and are not
 * bound by it.
 */
export function contentSecurityPolicy(nonce: string): string {
  const script = `script-src 'self' 'nonce-${nonce}' ${INLINE_SCRIPT_HASHES} 'strict-dynamic'${DEV ? " 'unsafe-eval'" : ""}`;
  return [script, ...STATIC_DIRECTIVES].join("; ");
}
