import type { Metadata } from "next";
import { PortfolioView } from "@/components/portfolio/portfolio";

export const metadata: Metadata = { title: "Portfolio" };

export default function PortfolioPage() {
  return (
    <div className="pt-4 pb-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Portfolio</h1>
        <p className="mt-2 text-[15px] text-muted">Your backed launches, fees, refunds and holdings.</p>
      </div>
      <PortfolioView />
    </div>
  );
}
