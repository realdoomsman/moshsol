import type { MetadataRoute } from "next";
import { DOCS } from "@/components/docs/registry";
import { api } from "@/lib/api";
import { SITE_URL } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Static pages, every docs page and the 200 newest launches (indexer unreachable → static pages only). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = ["", "/app", "/agents", "/leaderboard", "/create", "/docs", "/terms", "/privacy"].map((p) => ({ url: `${SITE_URL}${p}` }));
  const docs = DOCS.filter((d) => d.slug).map((d) => ({ url: `${SITE_URL}/docs/${d.slug}` }));
  const launches = await api
    .launches({ status: "all", sort: "new", limit: 200 })
    .then((r) => r.launches.map((l) => ({ url: `${SITE_URL}/launch/${l.mint}`, lastModified: new Date((l.lastTradeAt ?? l.createdAt) * 1000) })))
    .catch(() => []);
  return [...pages, ...docs, ...launches];
}
