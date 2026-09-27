import LaunchCard from "../opengraph-image";

/**
 * The launch's share card (the `og:image`) at a stable URL for the header's "Download card": Next
 * serves metadata images under a content-hashed path (`/launch/<mint>/opengraph-image-<hash>`).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  const res = await LaunchCard({ params: ctx.params });
  const headers = new Headers(res.headers);
  headers.set("content-disposition", `inline; filename="holdfast-${mint.slice(0, 8)}.png"`);
  return new Response(res.body, { status: res.status, headers });
}
