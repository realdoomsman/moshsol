import type { Metadata } from "next";
import { HowItWorks } from "@/components/how/how-it-works";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { platformQuery } from "@/lib/query-options";

export const metadata: Metadata = { title: "How it works" };

export default async function HowItWorksPage() {
  const client = serverQueryClient();
  await prefetch(client, platformQuery());
  return (
    <Hydrate client={client}>
      <HowItWorks />
    </Hydrate>
  );
}
