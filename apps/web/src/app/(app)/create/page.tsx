import type { Metadata } from "next";
import { CreateForm } from "@/components/create/create-form";
import { PageHeader } from "@/components/legacy/page-header";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { platformQuery } from "@/lib/query-options";

export const metadata: Metadata = { title: "Create a launch" };

export default async function CreatePage() {
  // Fees, raise bounds and the preview defaults come from the platform params.
  const client = serverQueryClient();
  await prefetch(client, platformQuery());
  return (
    <div className="pt-4 pb-8">
      <PageHeader eyebrow="Create" title="Create a launch">
        Open a raise. When it closes, the pooled SOL buys the first slice of the curve as a bundle that is locked in an
        on-chain vault forever — traded only by rate-limited agents, with backers earning the fees.
      </PageHeader>
      <Hydrate client={client}>
        <CreateForm />
      </Hydrate>
    </div>
  );
}
