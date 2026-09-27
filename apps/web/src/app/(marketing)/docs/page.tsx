import type { Metadata } from "next";
import { DOCS } from "@/components/docs/registry";
import { renderDoc } from "@/components/docs/render-doc";

const overview = DOCS[0];

export const metadata: Metadata = { title: "Docs", description: overview.description };

export default function DocsIndexPage() {
  return renderDoc(overview);
}
