"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { explorerTx } from "./explorer";
import type * as Program from "./program";

export interface TxRequest {
  /** Short action label, e.g. "Buy $MOSH". */
  label: string;
  build: (payer: PublicKey) => Promise<TransactionInstruction[]>;
  signers?: Keypair[];
  /**
   * Chain-read query keys to refresh after confirmation. Indexer data refreshes itself from the
   * `/ws` push once the indexer has processed the transaction.
   */
  invalidate?: QueryKey[];
  successMessage?: string;
}

/** Where a transaction is in the wallet pipeline (§3.8.6); drives button copy and the toast. */
export type TxStage = "preparing" | "signing" | "sending" | "confirming";

/** Button/toast copy per stage, e.g. `<Button busy>{TX_STAGE_LABEL[stage]}</Button>`. */
export const TX_STAGE_LABEL: Record<TxStage, string> = {
  preparing: "Preparing",
  signing: "Confirm in wallet",
  sending: "Sending",
  confirming: "Confirming",
};

export function ExplorerLink({ signature, children = "View on explorer" }: { signature: string; children?: string }) {
  return (
    <a
      href={explorerTx(signature)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-medium text-ink underline decoration-ink-3/60 underline-offset-2 hover:decoration-ink"
    >
      {children} <ExternalLink className="size-3" strokeWidth={1.5} aria-hidden />
    </a>
  );
}

/**
 * Wallet transaction pipeline: build → simulate (human errors before the wallet prompt; sizes the
 * compute limit) with the priority-fee estimate → partial-sign extra signers → wallet sign → send and
 * rebroadcast until confirmed, with a single evolving toast. Public trades that collide with a
 * vault-agent trade in one slot (anti-sandwich rule) are retried a slot later instead of shown.
 * `stage` follows the pipeline for button copy; success toasts stay 6 s, errors until dismissed.
 * The landing code and program-error messages (`./program`) load with the first transaction, not the page.
 */
export function useTx() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [stage, setStage] = useState<TxStage | null>(null);

  const run = useCallback(
    async (req: TxRequest): Promise<string | null> => {
      if (!publicKey) {
        setVisible(true);
        return null;
      }
      const id = toast.loading(req.label, { description: `${TX_STAGE_LABEL.preparing}…` });
      setPending(req.label);
      setStage("preparing");
      let program: typeof Program | null = null;
      try {
        // Dynamic on purpose: keeps Anchor and the IDL out of every page that merely offers a transaction.
        program = await import("./program");
        const ixs = await req.build(publicKey);
        const { tx, lastValidBlockHeight } = await program.prepareTx(connection, publicKey, ixs, program.DEFAULT_PRIORITY_FEE);

        if (req.signers?.length) tx.partialSign(...req.signers);
        setStage("signing");
        toast.loading(req.label, { id, description: `${TX_STAGE_LABEL.signing}…` });

        const confirming = (signature: string) => {
          setStage("confirming");
          toast.loading(req.label, { id, description: <ExplorerLink signature={signature} /> });
        };
        let signature: string;
        if (signTransaction) {
          const signed = await signTransaction(tx);
          setStage("sending");
          toast.loading(req.label, { id, description: `${TX_STAGE_LABEL.sending}…` });
          signature = await program.sendAndConfirm(connection, signed.serialize(), lastValidBlockHeight, confirming);
        } else {
          // The wallet broadcasts it (compute limit and price included); only confirmation is ours.
          signature = await sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
          confirming(signature);
          await program.confirmSignature(connection, signature, lastValidBlockHeight);
        }

        toast.success(req.successMessage ?? `${req.label} confirmed`, {
          id,
          description: <ExplorerLink signature={signature} />,
          duration: 6_000,
        });
        qc.invalidateQueries({ queryKey: ["sol"] });
        for (const key of req.invalidate ?? []) qc.invalidateQueries({ queryKey: key });
        return signature;
      } catch (err) {
        const description = program ? program.humanError(err) : "Couldn't load the transaction code. Check your connection and try again.";
        toast.error(`${req.label} failed`, { id, description, duration: Infinity });
        return null;
      } finally {
        setPending(null);
        setStage(null);
      }
    },
    [connection, publicKey, qc, sendTransaction, setVisible, signTransaction],
  );

  return { run, pending, stage, connected: !!publicKey };
}
