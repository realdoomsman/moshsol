"use client";

import { describeError } from "@holdfast/sdk";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction, type Keypair, type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useMoshClient } from "./chain";
import { explorerTx } from "./explorer";

class SimulationError extends Error {
  readonly logs: string[];
  constructor(txErr: unknown, logs: string[]) {
    const raw = JSON.stringify(txErr);
    const custom = raw.match(/"Custom":(\d+)/);
    // Surface custom codes in the format describeError maps through the IDL.
    super(custom ? `custom program error: 0x${Number(custom[1]).toString(16)}` : raw);
    this.logs = logs;
  }
}

/** Collects program logs from web3 / wallet-adapter / simulation errors and maps them to a program error message. */
export function humanError(err: unknown): string {
  const e = err as { message?: string; logs?: string[]; error?: { logs?: string[]; message?: string } };
  const logs = e?.logs ?? e?.error?.logs ?? [];
  const message = [e?.message, e?.error?.message].filter(Boolean).join("\n") || String(err);
  if (/AccountNotFound|InsufficientFundsForFee/.test(message)) return "Not enough SOL to pay network fees";
  return describeError({ message, logs });
}

export interface TxRequest {
  /** Short action label, e.g. "Buy $MOSH". */
  label: string;
  build: (payer: PublicKey) => Promise<TransactionInstruction[]>;
  signers?: Keypair[];
  computeUnits?: number;
  /**
   * Chain-read query keys to refresh after confirmation. Indexer data refreshes itself from the
   * `/ws` push once the indexer has processed the transaction.
   */
  invalidate?: QueryKey[];
  successMessage?: string;
}

function ExplorerLink({ signature }: { signature: string }) {
  return (
    <a
      href={explorerTx(signature)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-medium text-lime hover:underline"
    >
      View transaction <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

/**
 * Wallet transaction pipeline: build → simulate (human errors before the wallet prompt) →
 * partial-sign extra signers → wallet sign → send → confirm, with a single evolving toast.
 */
export function useTx() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMoshClient();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const run = useCallback(
    async (req: TxRequest): Promise<string | null> => {
      if (!publicKey) {
        setVisible(true);
        return null;
      }
      const id = toast.loading(req.label, { description: "Preparing transaction…" });
      setPending(req.label);
      try {
        const ixs = await req.build(publicKey);
        const { tx, blockhash, lastValidBlockHeight } = await client.buildTx(publicKey, ixs, {
          computeUnits: req.computeUnits ?? 300_000,
        });

        const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: "confirmed",
        });
        if (sim.value.err) {
          throw new SimulationError(sim.value.err, sim.value.logs ?? []);
        }

        if (req.signers?.length) tx.partialSign(...req.signers);
        toast.loading(req.label, { id, description: "Approve in your wallet…" });

        let signature: string;
        if (signTransaction) {
          const signed = await signTransaction(tx);
          toast.loading(req.label, { id, description: "Sending…" });
          signature = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
        } else {
          signature = await sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
        }

        toast.loading(req.label, { id, description: <ExplorerLink signature={signature} /> });
        const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        if (res.value.err) {
          const info = await connection.getTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          throw new SimulationError(res.value.err, info?.meta?.logMessages ?? []);
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
        toast.error(`${req.label} failed`, { id, description: humanError(err), duration: 8_000 });
        return null;
      } finally {
        setPending(null);
      }
    },
    [client, connection, publicKey, qc, sendTransaction, setVisible, signTransaction],
  );

  return { run, pending, connected: !!publicKey };
}
