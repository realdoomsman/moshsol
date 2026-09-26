import type { Metadata } from "next";
import { CreateForm } from "@/components/create/create-form";

export const metadata: Metadata = { title: "Create a launch" };

export default function CreatePage() {
  return (
    <div className="pt-4 pb-8">
      <div className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Create a launch</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Open a raise. When it closes, the pooled SOL buys the first slice of the curve as a bundle that is locked in
          an on-chain vault forever — traded only by rate-limited agents, with backers earning the fees.
        </p>
      </div>
      <CreateForm />
    </div>
  );
}
