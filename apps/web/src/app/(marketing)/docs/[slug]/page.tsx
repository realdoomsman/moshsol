import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOCS } from "@/components/docs/registry";
import { renderDoc } from "@/components/docs/render-doc";

const find = (slug: string) => DOCS.find((d) => d.slug === slug && slug !== "");

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = find((await params).slug);
  // Unknown slugs 404 (not-found.tsx); browsers still get this streamed title, so it must say so too.
  return page
    ? { title: `${page.title} · Docs`, description: page.description, alternates: { canonical: `/docs/${page.slug}` } }
    : { title: "Page not found" };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = find((await params).slug);
  if (!page) notFound();
  return renderDoc(page);
}
