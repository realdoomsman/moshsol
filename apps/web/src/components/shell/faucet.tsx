"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CLUSTER, IS_TEST_CLUSTER } from "@/lib/env";
import { ExplorerLink, humanError } from "@/lib/tx";
import { Button } from "../ui/button";

/** The public devnet faucet rate-limits aggressively; ask for less there. */
export const AIRDROP_SOL = CLUSTER === "devnet" ? 1 : 2;
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

/**
 * Test-SOL airdrop for devnet/localnet. RPC airdrops are IP rate-limited on devnet, so a failure
 * there copies the address and points at the web faucet instead. Opens the wallet modal when
 * disconnected. `available` is false on mainnet.
 */
export function useAirdrop() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const request = async () => {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    setBusy(true);
    const id = toast.loading(`Requesting ${AIRDROP_SOL} test SOL`);
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
      toast.success(`${AIRDROP_SOL} test SOL received`, {
        id,
        duration: 6_000,
        description: <ExplorerLink signature={signature} />,
      });
      qc.invalidateQueries({ queryKey: ["sol"] });
    } catch (err) {
      if (CLUSTER === "devnet") {
        await navigator.clipboard?.writeText(publicKey.toBase58()).catch(() => {});
        toast.error("The devnet faucet is rate-limited right now", {
          id,
          duration: Infinity,
          description: (
            <span>
              Your address is copied. Paste it at{" "}
              <a
                className="font-medium text-ink underline decoration-ink-3/60 underline-offset-2 hover:decoration-ink"
                href={WEB_FAUCET}
                target="_blank"
                rel="noreferrer"
              >
                faucet.solana.com
              </a>{" "}
              to get devnet SOL.
            </span>
          ),
        });
      } else {
        toast.error("Airdrop failed", { id, duration: Infinity, description: humanError(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  return { available: IS_TEST_CLUSTER, busy, request };
}

/** "Get test SOL" (ghost sm, §4.3) — renders nothing on mainnet. */
export function FaucetButton({ className }: { className?: string }) {
  const { available, busy, request } = useAirdrop();
  if (!available) return null;
  return (
    <Button variant="ghost" size="sm" busy={busy} onClick={request} title={`Airdrop ${AIRDROP_SOL} test SOL to your wallet`} className={className}>
      Get test SOL
    </Button>
  );
}
