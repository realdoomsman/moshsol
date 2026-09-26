import type { Metadata } from "next";
import { CreateForm } from "@/components/create/create-form";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { platformQuery } from "@/lib/query-options";

export const metadata: Metadata = { title: "Create a launch" };

export default async function CreatePage() {
  // Fees, raise bounds and the preview defaults come from the platform params.
  const client = serverQueryClient();
  await prefetch(client, platformQuery());
  return (
    <div className="pt-4 pb-8">
      <div className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Create a launch</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Open a raise. When it closes, the pooled SOL buys the first slice of the curve as a bundle that is locked in
          an on-chain vault forever — traded only by rate-limited agents, with backers earning the fees.
        </p>
      </div>
      <Hydrate client={client}>
        <CreateForm />
      </Hydrate>
    </div>
  );
}
