/**
 * Server-side proxy from this origin's `/api/auth/*` and `/api/wallet/*` to the accounts service
 * (`ACCOUNTS_URL`, read at runtime, never sent to browsers), so its cookies are first-party and
 * the browser never talks to it directly. Only what the service needs goes through: cookies, the
 * CSRF signals (`x-holdfast`, `Origin`, `Sec-Fetch-Site`) and the client address; redirects
 * (OAuth) and `Set-Cookie` come back unchanged.
 */
const REQUEST_HEADERS = ["cookie", "content-type", "origin", "sec-fetch-site", "x-holdfast", "x-forwarded-for", "user-agent"];
const RESPONSE_HEADERS = ["content-type", "location", "cache-control", "retry-after"];
const TIMEOUT_MS = 15_000;

export async function proxyToAccounts(req: Request): Promise<Response> {
  const base = (process.env.ACCOUNTS_URL || "http://127.0.0.1:8789").replace(/\/+$/, "");
  const { pathname, search } = new URL(req.url);
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  let res: Response;
  try {
    res = await fetch(`${base}${pathname}${search}`, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return Response.json({ error: "Accounts service unavailable. Try again shortly." }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  const out = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  for (const cookie of res.headers.getSetCookie()) out.append("set-cookie", cookie);
  return new Response(res.body, { status: res.status, headers: out });
}
