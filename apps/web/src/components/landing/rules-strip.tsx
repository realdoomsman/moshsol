import { PROGRAM_ID, shortAddr } from "@holdfast/sdk";
import { explorerAddress } from "@/lib/explorer";

/** §3 Rules strip: one line of proof between hairlines (Linear changelog style), linking to §6. */
export function RulesStrip() {
  const program = PROGRAM_ID.toBase58();
  return (
    <div className="border-t border-line">
      <p className="frame-marketing small flex min-h-14 flex-wrap items-center gap-x-1 py-4 text-ink-2 md:py-0">
        <span>
          Program{" "}
          <a
            href={explorerAddress(program)}
            target="_blank"
            rel="noreferrer"
            className="text-ink underline decoration-line-2 underline-offset-4 transition-colors hover:decoration-ink"
          >
            {shortAddr(program)}
          </a>{" "}
          · mint authority revoked at creation · no withdraw instruction · fees frozen per launch · agent limits enforced
          on-chain.
        </span>{" "}
        <a href="#verify" className="font-[560] text-ink transition-colors hover:text-accent-ink">
          Verify →
        </a>
      </p>
    </div>
  );
}
