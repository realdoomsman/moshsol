"use client";

import { lamportsToSol, shortAddr } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ArrowUpRight, Briefcase, ChevronDown, Copy, Droplets, LogOut, Repeat, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useSolBalance } from "@/lib/chain";
import { explorerAddress } from "@/lib/explorer";
import { fmtSolValue } from "@/lib/format";
import { useMounted } from "@/lib/hooks";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Identicon } from "../ui/identicon";
import { MenuItem, MenuSeparator, Popover } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { AIRDROP_SOL, useAirdrop } from "./faucet";

const ICON = { className: "size-4", strokeWidth: 1.5, "aria-hidden": true } as const;

/**
 * Header wallet control (§4.3). Disconnected: "Connect" (primary sm) → the wallet modal.
 * Connected: identicon, SOL balance, short address, chevron → menu with balance, profile,
 * portfolio, copy, explorer, test SOL (devnet/localnet), change wallet, disconnect.
 * Below 768px the connected button shows only the identicon.
 */
export function WalletButton() {
  const mounted = useMounted();
  const { publicKey, wallet, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const balance = useSolBalance(publicKey);
  const airdrop = useAirdrop();

  if (!mounted || !publicKey) {
    return (
      <Button variant="primary" size="sm" busy={mounted && connecting} onClick={() => setVisible(true)}>
        {mounted && connecting ? "Connecting" : "Connect"}
      </Button>
    );
  }

  const address = publicKey.toBase58();
  const sol = balance.data !== undefined ? `${fmtSolValue(lamportsToSol(balance.data))} SOL` : null;

  return (
    <Popover
      role="menu"
      label="Wallet"
      width={280}
      placement="bottom-end"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          aria-label={`Wallet ${shortAddr(address)}${sol ? `, ${sol}` : ""}`}
          className={cn(
            "ui flex h-8 items-center gap-2 rounded-sm border border-line-2 bg-surface px-2.5 text-ink transition-colors hover:bg-sunken pointer-coarse:h-10 md:pr-2 md:pl-1.5",
          )}
        >
          <Identicon address={address} size={20} />
          <span className="num hidden whitespace-nowrap md:inline">{sol ?? <Spinner className="text-ink-3" />}</span>
          <span className="mono hidden text-ink-2 lg:inline">{shortAddr(address)}</span>
          <ChevronDown
            className={cn(
              "hidden size-4 text-ink-3 transition-transform duration-(--dur-2) md:block",
              p["aria-expanded"] && "rotate-180",
            )}
            strokeWidth={1.5}
            aria-hidden
          />
        </button>
      )}
    >
      <div className="flex items-center gap-3 px-3 pt-3 pb-3">
        <Identicon address={address} size={32} />
        <div className="min-w-0">
          <div className="mono truncate text-ink">{shortAddr(address, 6)}</div>
          <div className="micro text-ink-3">{wallet?.adapter.name ?? "Wallet"}</div>
        </div>
      </div>
      <div className="border-y border-line px-3 py-2.5">
        <div className="label text-ink-3">Balance</div>
        <div className="num-l mt-0.5 text-ink">{sol ?? "—"}</div>
      </div>
      <div className="py-1">
        <MenuItem href={`/u/${address}`} icon={<UserRound {...ICON} />}>
          Profile
        </MenuItem>
        <MenuItem href="/portfolio" icon={<Briefcase {...ICON} />}>
          Portfolio
        </MenuItem>
        <MenuItem
          icon={<Copy {...ICON} />}
          onClick={() => {
            void navigator.clipboard.writeText(address).then(
              () => toast.success("Address copied"),
              () => toast.error("Couldn't copy", { description: "Your browser blocked clipboard access." }),
            );
          }}
        >
          Copy address
        </MenuItem>
        <MenuItem href={explorerAddress(address)} external icon={<ArrowUpRight {...ICON} />}>
          View on explorer
        </MenuItem>
        {airdrop.available ? (
          <MenuItem icon={<Droplets {...ICON} />} disabled={airdrop.busy} onClick={() => void airdrop.request()}>
            Get {AIRDROP_SOL} test SOL
          </MenuItem>
        ) : null}
        <MenuItem icon={<Repeat {...ICON} />} onClick={() => setVisible(true)}>
          Change wallet
        </MenuItem>
        <MenuSeparator />
        <MenuItem tone="danger" icon={<LogOut {...ICON} />} onClick={() => void disconnect()}>
          Disconnect
        </MenuItem>
      </div>
    </Popover>
  );
}
