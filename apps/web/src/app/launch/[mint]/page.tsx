import { PublicKey } from "@solana/web3.js";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LaunchView } from "@/components/launch/launch-view";

export const metadata: Metadata = { title: "Launch" };

export default async function LaunchPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  try {
    new PublicKey(mint);
  } catch {
    notFound();
  }
  return <LaunchView mint={mint} />;
}
