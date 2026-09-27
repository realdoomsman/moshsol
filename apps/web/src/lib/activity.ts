import { shortAddr } from "@holdfast/sdk";
import { fmtLamports } from "./format";
import type { ActivityEvent } from "./types";

export type ActivityTone = "up" | "down" | "violet" | "lime" | "neutral" | "warn";

export interface ActivityText {
  who: string;
  verb: string;
  amount: string | null;
  tone: ActivityTone;
}

/** Human sentence parts for an indexer activity event. */
export function describeActivity(e: ActivityEvent): ActivityText {
  const who = e.isAgent ? "Agent" : shortAddr(e.actor);
  const sol = e.solAmount ? `${fmtLamports(e.solAmount)} SOL` : null;
  switch (e.type) {
    case "trade":
      return { who, verb: e.isBuy ? "bought" : "sold", amount: sol, tone: e.isBuy ? "up" : "down" };
    case "deposit":
      return { who, verb: "backed", amount: sol, tone: "violet" };
    case "launch_created":
      return { who, verb: "opened a raise", amount: null, tone: "lime" };
    case "launched":
      return { who, verb: "launched", amount: null, tone: "lime" };
    case "refund":
      return { who, verb: "refunded", amount: sol, tone: "warn" };
    case "cancelled":
      return { who, verb: "cancelled the raise", amount: null, tone: "warn" };
    case "backer_claim":
      return { who, verb: "claimed backer fees", amount: sol, tone: "up" };
    case "creator_claim":
      return { who, verb: "claimed creator fees", amount: sol, tone: "up" };
  }
}

export const TONE_TEXT: Record<ActivityTone, string> = {
  up: "text-up",
  down: "text-down",
  violet: "text-[#c2a6ff]",
  lime: "text-lime",
  neutral: "text-muted",
  warn: "text-warn",
};
