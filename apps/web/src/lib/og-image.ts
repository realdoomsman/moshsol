import { INDEXER_URL } from "@/lib/env";

/** Formats the OG renderer can decode; anything else falls back to the drawn tile. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/svg+xml"];
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** Public gateways launch images and avatars are stored on (the indexer rewrites `ipfs://` to ipfs.io). */
const GATEWAY_HOSTS = ["arweave.net", "ar-io.dev", "ipfs.io"];

/**
 * Only images from our own indexer (`/files`) or a known public gateway are fetched. Metadata image URLs are
 * creator-controlled, and this runs on the server: without the allow-list any launch could point the share-card
 * render at loopback, the private network or the cloud metadata endpoint. Redirects are re-checked per hop.
 */
export function isAllowedImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.origin === new URL(INDEXER_URL).origin) return url.pathname.startsWith("/files/");
  if (url.protocol !== "https:") return false;
  return GATEWAY_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

/** The image as a data URI the OG renderer can embed, or null when it is unreachable, too big, not an image or off the allow-list. */
export async function imageDataUri(raw: string | null, types = IMAGE_TYPES): Promise<string | null> {
  if (!raw) return null;
  try {
    let url = raw;
    const signal = AbortSignal.timeout(3_000);
    for (let hop = 0; ; hop++) {
      if (!isAllowedImageUrl(url)) return null;
      const res = await fetch(url, { signal, redirect: "manual" });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (hop >= MAX_REDIRECTS) return null;
        url = new URL(location, url).toString();
        continue;
      }
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!res.ok || !types.includes(type)) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) return null;
      return `data:${type};base64,${bytes.toString("base64")}`;
    }
  } catch {
    return null;
  }
}
