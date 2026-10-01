"use client";

import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_DECIMALS, TOKEN_2022_PROGRAM_ID, solToLamports, tokenAta, uiToTokens } from "@holdfast/sdk";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Copy, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { fmtLamports, fmtTokens } from "@/lib/format";
import { AccountsError, EXPORT_AFTER_REAUTH_KEY, exportSecretKey, startGoogleSignIn } from "@/lib/google-wallet";
import { usePortfolio } from "@/lib/queries";
import { useSolBalance } from "@/lib/sol-balance";
import { TX_STAGE_LABEL, useTx } from "@/lib/tx";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { AmountInput, Field, Input } from "../ui/input";
import { Select } from "../ui/select";

/**
 * Key export for the Google (custodial) wallet. The accounts service releases the key only within
 * 10 minutes of a Google sign-in and once per sign-in; otherwise this goes through Google again and
 * the wallet menu reopens the dialog (`autoReveal`) when the page comes back.
 */
export function ExportKeyDialog({
  open,
  onOpenChange,
  autoReveal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoReveal: boolean;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSecret(await exportSecretKey());
      setBusy(false);
    } catch (err) {
      if (err instanceof AccountsError && err.message === "reauth_required") {
        // Leaves the page; `busy` stays on until it does.
        window.sessionStorage.setItem(EXPORT_AFTER_REAUTH_KEY, "1");
        startGoogleSignIn(true);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (open && autoReveal) void reveal();
  }, [open, autoReveal, reveal]);

  const close = (next: boolean) => {
    if (next) return onOpenChange(true);
    setSecret(null);
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Export private key"
      description="The key to your Google wallet, for importing into Phantom, Solflare or Backpack."
      width={480}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>
            {secret ? "Done" : "Cancel"}
          </Button>
          {secret ? (
            <Button
              variant="primary"
              icon={<Copy className="size-4" strokeWidth={1.5} />}
              onClick={() => {
                void navigator.clipboard.writeText(secret).then(
                  () => toast.success("Private key copied"),
                  () => toast.error("Couldn't copy", { description: "Your browser blocked clipboard access." }),
                );
              }}
            >
              Copy key
            </Button>
          ) : (
            <Button variant="danger" busy={busy} onClick={() => void reveal()}>
              Show private key
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-5 pt-3 pb-5">
        <p className="small flex gap-2 border-l-2 border-warn pl-3 text-ink-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={1.5} aria-hidden />
          Anyone with this key controls the wallet and everything in it. Holdfast will never ask you for it. Showing it
          needs a Google sign-in from the last 10 minutes, and each sign-in shows it once.
        </p>
        {secret ? (
          <output aria-label="Private key (base58)" className="mono block rounded-sm border border-line-2 bg-sunken p-3 break-all text-ink select-all">
            {secret}
          </output>
        ) : null}
        {error ? (
          <p role="alert" className="small text-down">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** SOL kept back on "Max": rent-exempt minimum for a wallet account (0.00089 SOL) plus fees. */
const SOL_RESERVE_LAMPORTS = 1_000_000n;
const SOL = "SOL";

/** Typed amount → base units (lamports, or token units for a Holdfast token); null when unparseable. */
function parseAmount(raw: string, token: boolean): bigint | null {
  if (raw.trim() === "") return null;
  try {
    return token ? uiToTokens(raw) : solToLamports(raw);
  } catch {
    return null;
  }
}

/** Base units → the exact decimal the amount field takes ("1.5", not "1.500000000"). */
function toInput(units: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const frac = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${units / scale}.${frac}` : `${units / scale}`;
}

/** A regular wallet address (on the ed25519 curve), or an error to show. */
function parseDestination(raw: string, own: string): { key: PublicKey } | { error: string } | null {
  const v = raw.trim();
  if (v === "") return null;
  let key: PublicKey;
  try {
    key = new PublicKey(v);
  } catch {
    return { error: "Not a Solana address." };
  }
  if (key.toBase58() !== v) return { error: "Not a Solana address." };
  if (v === own) return { error: "That's this wallet." };
  if (!PublicKey.isOnCurve(key.toBytes())) return { error: "That's a program address, not a wallet. Send to a wallet address." };
  return { key };
}

/**
 * Sends SOL or a Holdfast token from the Google wallet to any Solana wallet. Signed like every other
 * transaction (`useTx` → the accounts service), so its policy applies: a System transfer from this
 * wallet, or a Token-2022 transfer (creating the recipient's token account if needed).
 */
export function WithdrawDialog({ open, onOpenChange, owner }: { open: boolean; onOpenChange: (open: boolean) => void; owner: PublicKey }) {
  const address = owner.toBase58();
  const sol = useSolBalance(owner);
  const portfolio = usePortfolio(open ? address : null);
  const { run, pending, stage } = useTx();
  const [asset, setAsset] = useState(SOL);
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");

  const holdings = (portfolio.data?.holdings ?? []).filter((h) => BigInt(h.amount) > 0n);
  const holding = asset === SOL ? null : (holdings.find((h) => h.launch.mint === asset) ?? null);
  const unit = holding ? `$${holding.launch.symbol}` : SOL;
  const decimals = holding ? TOKEN_DECIMALS : 9;
  const available = holding
    ? BigInt(holding.amount)
    : sol.data !== undefined
      ? sol.data > SOL_RESERVE_LAMPORTS
        ? sol.data - SOL_RESERVE_LAMPORTS
        : 0n
      : undefined;
  const value = parseAmount(amount, holding !== null);
  const destination = parseDestination(to, address);
  const amountError =
    amount !== "" && (value === null || value === 0n)
      ? "Enter an amount."
      : value !== null && available !== undefined && value > available
        ? holding
          ? "More than this wallet holds."
          : "More than the wallet can send (0.001 SOL stays for rent and fees)."
        : null;
  const ready = value !== null && value > 0n && !amountError && destination !== null && "key" in destination && !pending;
  const balanceText = available === undefined ? undefined : holding ? `${fmtTokens(available)} ${unit}` : `${fmtLamports(available)} SOL`;

  const close = (next: boolean) => {
    if (pending) return;
    if (!next) {
      setAmount("");
      setTo("");
      setAsset(SOL);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!ready || !("key" in destination) || value === null) return;
    const dest = destination.key;
    const mint = holding ? new PublicKey(holding.launch.mint) : null;
    const signature = await run({
      label: `Withdraw ${amount} ${unit}`,
      build: async (payer) => {
        if (!mint) return [SystemProgram.transfer({ fromPubkey: payer, toPubkey: dest, lamports: value })];
        const destAta = tokenAta(dest, mint);
        return [
          createAssociatedTokenAccountIdempotentInstruction(payer, destAta, dest, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
          createTransferCheckedInstruction(tokenAta(payer, mint), mint, destAta, payer, value, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID),
        ];
      },
      invalidate: [["portfolio", address], ...(mint ? [["token-balance", mint.toBase58()]] : [])],
      successMessage: `Sent ${amount} ${unit}`,
    });
    if (signature) close(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Withdraw"
      description="Send SOL or tokens from your Google wallet to another Solana wallet."
      width={480}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)} disabled={!!pending}>
            Cancel
          </Button>
          <Button type="submit" form="withdraw" variant="primary" busy={!!pending} disabled={!ready}>
            {pending && stage ? TX_STAGE_LABEL[stage] : `Send ${unit}`}
          </Button>
        </div>
      }
    >
      <form
        id="withdraw"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-5 px-5 pt-3 pb-5"
      >
        <Field label="Asset">
          {() => (
            <Select
              label="Asset to send"
              value={asset}
              onChange={(v) => {
                setAsset(v);
                setAmount("");
              }}
              options={[
                { value: SOL, label: SOL },
                ...holdings.map((h) => ({ value: h.launch.mint, label: `$${h.launch.symbol}`, hint: `${fmtTokens(h.amount)} held` })),
              ]}
              className="w-full"
            />
          )}
        </Field>
        <AmountInput
          value={amount}
          onChange={setAmount}
          unit={unit}
          decimals={decimals}
          balance={balanceText}
          onMax={available !== undefined ? () => setAmount(toInput(available, decimals)) : undefined}
          invalid={!!amountError}
          disabled={!!pending}
        />
        {amountError ? (
          <p role="alert" className="small -mt-3 text-down">
            {amountError}
          </p>
        ) : null}
        <Field label="To" hint="A Solana wallet address you control" error={destination && "error" in destination ? destination.error : undefined}>
          {(id) => (
            <Input
              id={id}
              value={to}
              autoComplete="off"
              spellCheck={false}
              placeholder="Wallet address"
              className="mono"
              invalid={!!destination && "error" in destination}
              disabled={!!pending}
              onChange={(e) => setTo(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
