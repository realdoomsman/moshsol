import type { Metadata } from "next";
import { HowItWorks } from "@/components/how/how-it-works";

export const metadata: Metadata = { title: "How it works" };

export default function HowItWorksPage() {
  return <HowItWorks />;
}
