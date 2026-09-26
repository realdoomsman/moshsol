"use client";

import { lamportsToSol, shortAddr } from "@moshsol/sdk";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, Droplets, ExternalLink, LogOut, Repeat, Wallet, Briefcase } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSolBalance } from "@/lib/chain";
import { CLUSTER, IS_TEST_CLUSTER } from "@/lib/env";
import { explorerAddress, explorerTx } from "@/lib/explorer";
import { fmtSolValue } from "@/lib/format";
import { useMounted } from "@/lib/hooks";
import { humanError } from "@/lib/tx";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";

// The public devnet faucet rate-limits aggressively; ask for less there.
const AIRDROP_SOL = CLUSTER === "devnet" ? 1 : 2;
const WEB_FAUCET = "https://faucet.solana.com";
const AIRDROP_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Airdrop timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function AirdropButton({ compact }: { compact?: boolean }) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!IS_TEST_CLUSTER) return null;

  const onClick = async () => {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    setBusy(true);
    const id = toast.loading(`Requesting ${AIRDROP_SOL} test SOL…`);
    try {
      // web3.js retries 429s and confirmTransaction waits for blockhash expiry; cap the whole
      // round trip so a throttled faucet fails fast into the fallback below.
      const signature = await withTimeout(
        (async () => {
          const sig = await connection.requestAirdrop(publicKey, AIRDROP_SOL * LAMPORTS_PER_SOL);
          const bh = await connection.getLatestBlockhash("confirmed");
          const res = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
          if (res.value.err) throw new Error("Airdrop transaction failed");
          return sig;
        })(),
        AIRDROP_TIMEOUT_MS,
      );
      toast.success(`+${AIRDROP_SOL} SOL airdropped`, {
        id,
        description: (
          <a className="font-medium text-lime hover:underline" href={explorerTx(signature)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        ),
      });
      qc.invalidateQueries({ queryKey: ["sol"] });
    } catch (err) {
      if (CLUSTER === "devnet") {
        // RPC airdrops are IP rate-limited; the web faucet (GitHub sign-in) almost always works.
        await navigator.clipboard?.writeText(publicKey.toBase58()).catch(() => {});
        toast.error("Devnet faucet is rate-limited right now", {
          id,
          duration: 12_000,
          description: (
            <span>
              Your address is copied —{" "}
              <a className="font-medium text-lime hover:underline" href={WEB_FAUCET} target="_blank" rel="noreferrer">
                get devnet SOL at faucet.solana.com
              </a>
            </span>
          ),
        });
      } else {
        toast.error("Airdrop failed", { id, description: humanError(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="secondary"
      size="md"
      onClick={onClick}
      loading={busy}
      icon={<Droplets className="size-4 text-cyan" aria-hidden />}
      aria-label={`Get ${AIRDROP_SOL} test SOL`}
      title={`Airdrop ${AIRDROP_SOL} test SOL to your wallet`}
      className={compact ? "px-3" : undefined}
    >
      {compact ? null : "Get test SOL"}
    </Button>
  );
}

export function WalletButton() {
  const mounted = useMounted();
  const { publicKey, wallet, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const balance = useSolBalance(publicKey);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!mounted || !publicKey) {
    return (
      <Button
        variant="primary"
        onClick={() => setVisible(true)}
        loading={mounted && connecting}
        icon={<Wallet className="size-4" aria-hidden />}
      >
        {connecting ? "Connecting" : "Connect"}
      </Button>
    );
  }

  const address = publicKey.toBase58();
  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-muted transition hover:bg-white/[0.06] hover:text-ink";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-10 items-center gap-2 rounded-xl border border-line bg-white/[0.05] pr-2.5 pl-1.5 text-sm font-semibold transition hover:border-line-strong hover:bg-white/[0.08]"
      >
        {wallet?.adapter.icon ? (
          // Wallet icons are data URIs supplied by the adapter.
          <img src={wallet.adapter.icon} alt="" className="size-7 rounded-lg bg-black/40 p-1" />
        ) : (
          <Wallet className="size-4" aria-hidden />
        )}
        <span className="whitespace-nowrap tabular-nums">
          {balance.data !== undefined ? `${fmtSolValue(lamportsToSol(balance.data))} SOL` : "— SOL"}
        </span>
        <span className="hidden text-dim sm:inline">·</span>
        <span className="hidden font-mono text-[12.5px] font-medium text-muted sm:inline">{shortAddr(address)}</span>
        <ChevronDown className={cn("size-4 text-dim transition", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 z-50 mt-2 w-64 origin-top-right rounded-2xl border border-line-strong bg-[#101317]/95 p-1.5 shadow-2xl backdrop-blur-xl"
          >
            <div className="px-3 pt-2.5 pb-3">
              <div className="text-xs text-dim">{wallet?.adapter.name ?? "Wallet"}</div>
              <div className="mt-0.5 font-mono text-[13px] text-ink">{shortAddr(address, 6)}</div>
              <div className="mt-2 text-xl font-semibold tabular-nums">
                {balance.data !== undefined ? fmtSolValue(lamportsToSol(balance.data)) : "—"}{" "}
                <span className="text-sm font-medium text-dim">SOL</span>
              </div>
            </div>
            <div className="h-px bg-line" />
            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  void navigator.clipboard.writeText(address);
                  toast.success("Address copied");
                  setOpen(false);
                }}
              >
                <Copy className="size-4" aria-hidden /> Copy address
              </button>
              <a role="menuitem" className={item} href={explorerAddress(address)} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" aria-hidden /> View on explorer
              </a>
              <Link role="menuitem" className={item} href="/portfolio" onClick={() => setOpen(false)}>
                <Briefcase className="size-4" aria-hidden /> Portfolio
              </Link>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  setVisible(true);
                }}
              >
                <Repeat className="size-4" aria-hidden /> Change wallet
              </button>
              <button
                type="button"
                role="menuitem"
                className={cn(item, "hover:text-down")}
                onClick={() => {
                  setOpen(false);
                  void disconnect();
                }}
              >
                <LogOut className="size-4" aria-hidden /> Disconnect
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
