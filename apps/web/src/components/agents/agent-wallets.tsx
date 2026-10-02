import type { PlatformInfo } from "@/lib/types";
import { AgentGlyph } from "../brand/glyphs";
import { Address } from "../ui/address";
import { Chip } from "../ui/chip";
import { EmptyState } from "../ui/empty-state";
import { Skeleton } from "../ui/skeleton";

/** "Agent · wallet 3": marks a trade executed by Holdfast agent wallet `n`. */
export function AgentWalletChip({ n }: { n: number }) {
  return (
    <Chip tone="accent" icon={<AgentGlyph size={10} />} title={`Holdfast agent wallet ${n}: executes the vault agent's trades`}>
      Agent · wallet {n}
    </Chip>
  );
}

/**
 * The shared agent wallets from the platform account (/agents): what they do, then one cell per
 * wallet ("Holdfast agent wallet 1" … 15) with its address, copy and explorer link.
 */
export function AgentWallets({ platform }: { platform: PlatformInfo | undefined }) {
  const wallets = platform?.agentExecutors;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-8">
      <div className="small grid content-start gap-3 text-ink-2">
        <p>
          {wallets?.length ? `These ${wallets.length} shared wallets` : "Shared agent wallets"} execute the vault agent&apos;s trades for
          every coin. Inside one program instruction, value moves vault → wallet → market → vault, and the program checks the wallet
          ends with exactly what it started with.
        </p>
        <p>
          So a wallet never holds a coin between trades, and the wallets never trade against each other: one trade per launch at a time,
          each one a decision of the same vault strategy. The agent key still signs every trade and every on-chain rule applies. The
          wallets pay their own transaction fees, topped up from the agent key.
        </p>
      </div>
      {!wallets ? (
        <div className="grid gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : wallets.length === 0 ? (
        <div className="rounded-md border border-line bg-surface">
          <EmptyState>Not set yet. Until the admin registers them, each vault&apos;s pump authority trades directly.</EmptyState>
        </div>
      ) : (
        <ol className="grid content-start gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
          {wallets.map((address, i) => (
            <li key={address} className="grid min-w-0 gap-1 bg-surface px-4 py-3">
              <span className="small text-ink-3">Holdfast agent wallet {i + 1}</span>
              <Address address={address} className="justify-start" />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
