import type { ReactNode } from "react";
import type { LaunchSummary, PlatformInfo } from "@/lib/types";
import type { ChainFacts } from "../landing/chain-facts";

export interface DocSection {
  /** Anchor id (also the TOC entry). */
  id: string;
  title: string;
  body: ReactNode;
}

/** Live values a page renders from — never typed into copy (§3.2). */
export interface DocContext {
  platform: PlatformInfo | null;
  p: PlatformInfo["params"] | null;
  /** The featured live launch (same pick as the landing), for worked examples. */
  seed: LaunchSummary | null;
  facts: ChainFacts;
}

export type DocGroup = "Start" | "Guides" | "Protocol" | "Reference";

export interface DocPage {
  /** "" = the /docs overview. */
  slug: string;
  group: DocGroup;
  /** Label in the left nav. */
  nav: string;
  title: string;
  description: string;
  sections: (ctx: DocContext) => DocSection[];
}
