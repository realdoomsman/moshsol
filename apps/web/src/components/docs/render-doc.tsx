import { loadChainFacts } from "../landing/chain-facts";
import { prefetchLanding } from "../landing/featured";
import { Hydrate, serverQueryClient } from "@/lib/prefetch";
import { platformQuery } from "@/lib/query-options";
import { DocLayout } from "./doc-layout";
import { DOCS, docFile } from "./registry";
import type { DocPage } from "./types";
import { docUpdated } from "./updated";

/** Server render of one docs page: live platform params + featured launch for embedded components. */
export async function renderDoc(page: DocPage) {
  const client = serverQueryClient();
  const { seed } = await prefetchLanding(client);
  const platform = client.getQueryData(platformQuery().queryKey) ?? null;
  const facts = await loadChainFacts(seed?.mint ?? null);
  const sections = page.sections({ platform, p: platform?.params ?? null, seed, facts });
  return (
    <Hydrate client={client}>
      <DocLayout page={page} pages={DOCS} sections={sections} updated={docUpdated(docFile(page))} />
    </Hydrate>
  );
}
