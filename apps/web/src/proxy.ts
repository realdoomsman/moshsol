import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/csp";

/**
 * A fresh CSP nonce per document request. Next reads the nonce back from the request's CSP header and stamps it on
 * every script it renders; every page is rendered per request (the root layout awaits `connection()`), so none is
 * served with a stale or missing nonce. The other security headers are static (next.config.ts).
 */
export function proxy(request: NextRequest) {
  const policy = contentSecurityPolicy(btoa(crypto.randomUUID()));
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Documents only: not API routes, build assets, or files with an extension (public/, icons, manifest, robots).
      source: "/((?!api/|_next/static/|_next/image|.*\\.[a-z0-9]+$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
