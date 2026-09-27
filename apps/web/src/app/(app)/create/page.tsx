import { PublicKey } from "@solana/web3.js";
import type { Metadata } from "next";
import { CreateSuccess } from "@/components/create/success";
import { CreateWizard } from "@/components/create/create-wizard";
import { parsePrefill } from "@/components/create/validate";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { launchQuery, platformQuery } from "@/lib/query-options";

export const metadata: Metadata = { title: "Create a launch" };

function canonicalKey(v: string | string[] | undefined): string | null {
  if (typeof v !== "string") return null;
  try {
    return new PublicKey(v).toBase58() === v ? v : null;
  } catch {
    return null;
  }
}

/**
 * `/create` is the wizard; `/create?launched=<mint>&tx=<signature>` is its success screen (the
 * wizard lands there after the create transaction confirms, so a reload keeps it).
 */
export default async function CreatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const client = serverQueryClient();
  const launched = canonicalKey(q.launched);
  if (launched) {
    await prefetch(client, launchQuery(launched));
    const tx = typeof q.tx === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(q.tx) ? q.tx : null;
    return (
      <Hydrate client={client}>
        <CreateSuccess mint={launched} signature={tx} />
      </Hydrate>
    );
  }
  // Fees, raise bounds and the bundle preview all come from the platform params.
  await prefetch(client, platformQuery());
  return (
    <Hydrate client={client}>
      <CreateWizard prefill={parsePrefill(q)} />
    </Hydrate>
  );
}
