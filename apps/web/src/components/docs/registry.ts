import { forBackers, forCreators, forTraders, howItWorks } from "./pages/guides";
import { agents, fees, theVault, verify } from "./pages/protocol";
import { api, brand, faq, glossary, overview, program, risks } from "./pages/reference";
import type { DocPage } from "./types";

/** Docs pages in nav order (§4.11). */
export const DOCS: DocPage[] = [
  overview,
  howItWorks,
  forBackers,
  forCreators,
  forTraders,
  theVault,
  agents,
  fees,
  verify,
  program,
  api,
  faq,
  risks,
  glossary,
  brand,
];

/** Content file per page, for "Last updated" from git. */
export function docFile(page: DocPage): string {
  const group = [howItWorks, forBackers, forCreators, forTraders].includes(page)
    ? "guides"
    : [theVault, agents, fees, verify].includes(page)
      ? "protocol"
      : "reference";
  return `${group}.tsx`;
}
