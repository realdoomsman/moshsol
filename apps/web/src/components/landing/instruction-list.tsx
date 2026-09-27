import type { InstructionRow } from "./instructions";

/**
 * The Instruction list (§4.2 §6): one 48px row per program instruction from the IDL — name, who can
 * sign it, what it can move — grouped by lifecycle. Hover or focus expands a one-line description
 * (240 ms height). Ends with the instruction that isn't there.
 */
export function InstructionList({ rows }: { rows: InstructionRow[] }) {
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="label hidden grid-cols-[minmax(0,11rem)_minmax(0,9rem)_minmax(0,1fr)] gap-4 border-b border-line px-4 py-2.5 text-ink-3 md:grid">
        <span>Instruction</span>
        <span>Who can call</span>
        <span>What it can move</span>
      </div>
      {groups.map((g) => (
        <div key={g}>
          <p className="label border-b border-line bg-sunken/60 px-4 py-1.5 text-ink-3">{g}</p>
          <ul>
            {rows
              .filter((r) => r.group === g)
              .map((r) => (
                <li
                  key={r.name}
                  tabIndex={0}
                  className="group border-b border-line px-4 outline-none transition-colors hover:bg-sunken focus-visible:bg-sunken"
                >
                  <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5 md:grid-cols-[minmax(0,11rem)_minmax(0,9rem)_minmax(0,1fr)] md:py-0">
                    <span className="mono truncate text-ink">{r.name}</span>
                    <span className="small text-right text-ink-2 md:text-left">{r.caller}</span>
                    <span className="small col-span-2 text-ink-2 md:col-span-1">{r.moves}</span>
                  </div>
                  <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-(--dur-3) ease-(--ease-out) group-hover:grid-rows-[1fr] group-focus-visible:grid-rows-[1fr]">
                    <p className="small overflow-hidden text-ink-3">
                      <span className="block pb-3">{r.description}</span>
                    </p>
                  </div>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <div className="grid min-h-12 items-center gap-x-4 gap-y-1 bg-accent-wash px-4 py-3 md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
        <span className="mono text-accent-ink line-through">withdraw_vault</span>
        <span className="small text-accent-ink">
          Does not exist. No instruction moves vault funds except the agent trading the launch&rsquo;s own curve.
        </span>
      </div>
    </div>
  );
}
