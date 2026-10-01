import type { Metadata } from "next";
import { overview } from "@/components/docs/pages/reference";
import { renderDoc } from "@/components/docs/render-doc";

export const metadata: Metadata = { title: "Docs", description: overview.description };

export default function DocsIndexPage() {
  return renderDoc(overview);
}
