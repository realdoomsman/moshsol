import type { Metadata } from "next";
import { PortfolioView } from "@/components/portfolio/portfolio";
import { PageHeader } from "@/components/legacy/page-header";

export const metadata: Metadata = { title: "Portfolio" };

export default function PortfolioPage() {
  return (
    <div className="pt-4 pb-8">
      <PageHeader eyebrow="Portfolio" title="Your positions" tone="up">
        Backed launches, claimable fees, refunds and holdings — in one place.
      </PageHeader>
      <PortfolioView />
    </div>
  );
}
