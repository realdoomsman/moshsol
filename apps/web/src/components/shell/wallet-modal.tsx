"use client";

import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { useWallet, type Wallet } from "@solana/wallet-adapter-react";
import { WalletModalContext } from "@solana/wallet-adapter-react-ui";
import { ArrowUpRight, ChevronRight, KeyRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BURNER_WALLET_NAME } from "@/lib/burner";
import { CLUSTER_LABEL, CLUSTER, IS_TEST_CLUSTER } from "@/lib/env";
import { EXPORT_AFTER_REAUTH_KEY, GOOGLE_WALLET_NAME } from "@/lib/google-wallet";
import { Chip } from "../ui/chip";
import { cn } from "../ui/cn";
import { Dialog } from "../ui/dialog";
import { Spinner } from "../ui/spinner";

/** Wallets we point newcomers to when they aren't installed (§4.3). */
const INSTALLABLE = [
  { name: "Phantom", url: "https://phantom.com/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
  { name: "Backpack", url: "https://backpack.app/downloads" },
] as const;

function WalletIcon({ src, name }: { src?: string; name: string }) {
  return src ? (
    // Adapter icons are data URIs supplied by the wallet itself.
    <img src={src} alt="" width={28} height={28} className="size-7 shrink-0 rounded-sm" />
  ) : (
    <span aria-hidden className="label flex size-7 shrink-0 items-center justify-center rounded-sm bg-surface text-ink-2 ring-1 ring-line ring-inset">
      {name.slice(0, 1)}
    </span>
  );
}

const ROW =
  "flex h-12 w-full items-center gap-3 rounded-sm px-3 text-left transition-colors hover:bg-ink/[0.06] focus-visible:bg-ink/[0.06] disabled:pointer-events-none";

function Row({
  icon,
  name,
  right,
  onClick,
  href,
  busy,
}: {
  icon: ReactNode;
  name: ReactNode;
  right: ReactNode;
  onClick?: () => void;
  href?: string;
  busy?: boolean;
}) {
  const body = (
    <>
      {icon}
      <span className="ui min-w-0 flex-1 truncate text-ink">{name}</span>
      {busy ? <Spinner className="text-ink-3" /> : right}
    </>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={ROW}>
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} disabled={busy} className={ROW}>
      {body}
    </button>
  );
}

/** `?auth_error=` codes the accounts service redirects back with after a failed Google round trip. */
const AUTH_ERRORS: Record<string, string> = {
  cancelled: "Google sign-in was cancelled.",
  expired: "Google sign-in expired. Try again.",
  failed: "Google sign-in failed. Try again.",
};

/**
 * "Connect a wallet" (§4.3), replacing wallet-adapter-react-ui's modal: "Continue with Google"
 * (custodial wallet, no extension) first, then detected wallets (Wallet Standard auto-detects
 * Phantom, Solflare, Backpack…), then install links for the ones missing, then — on devnet/localnet
 * only — the in-browser test wallet. Bottom sheet on mobile.
 */
function WalletModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { wallets, wallet, select, connect, connecting } = useWallet();
  const [picked, setPicked] = useState<WalletName | null>(null);

  const { google, detected, burner, missing } = useMemo(() => {
    const ready = (w: Wallet) =>
      w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable;
    const ours = (w: Wallet) => w.adapter.name === BURNER_WALLET_NAME || w.adapter.name === GOOGLE_WALLET_NAME;
    const google = wallets.find((w) => w.adapter.name === GOOGLE_WALLET_NAME) ?? null;
    const burner = wallets.find((w) => w.adapter.name === BURNER_WALLET_NAME) ?? null;
    const detected = wallets.filter((w) => !ours(w) && ready(w));
    const names = new Set(detected.map((w) => w.adapter.name.toLowerCase()));
    const missing = INSTALLABLE.filter((i) => !names.has(i.name.toLowerCase()));
    return { google, detected, burner, missing };
  }, [wallets]);

  const choose = (name: WalletName) => {
    setPicked(name);
    if (wallet?.adapter.name === name) {
      // Re-picking the selected-but-disconnected wallet: select() is a no-op, so connect directly.
      void connect().catch(() => undefined);
    } else {
      // WalletProvider's autoConnect connects as soon as the selection lands.
      select(name);
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Connect a wallet"
      width={440}
      footer={
        <div className="small flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-ink-2">
          <a
            href="https://phantom.com/download"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:text-ink"
          >
            New to Solana? Get Phantom <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
          </a>
          <Link
            href="/docs"
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center gap-0.5 transition-colors hover:text-ink"
          >
            What&apos;s a wallet? <ChevronRight className="size-3.5" strokeWidth={1.5} aria-hidden />
          </Link>
        </div>
      }
    >
      <div className="grid gap-4 px-2 pt-4 pb-3">
        {google ? (
          <section aria-label="Sign in with Google" className="grid gap-2">
            <Row
              icon={<WalletIcon src={google.adapter.icon} name="Google" />}
              name="Continue with Google"
              right={<Chip tone="muted">No extension</Chip>}
              busy={connecting && picked === GOOGLE_WALLET_NAME}
              onClick={() => choose(GOOGLE_WALLET_NAME)}
            />
            <p className="small mx-3 text-ink-2">
              Holdfast creates a wallet for your Google account and keeps its key for you (custodial). You can withdraw or
              export the key any time from the wallet menu.
            </p>
          </section>
        ) : null}

        {detected.length ? (
          <section aria-label="Detected wallets" className={cn("grid", google && "border-t border-line pt-3")}>
            {detected.map((w) => (
              <Row
                key={w.adapter.name}
                icon={<WalletIcon src={w.adapter.icon} name={w.adapter.name} />}
                name={w.adapter.name}
                right={<Chip tone="muted">Detected</Chip>}
                busy={connecting && picked === w.adapter.name}
                onClick={() => choose(w.adapter.name)}
              />
            ))}
          </section>
        ) : (
          <p className={cn("small px-3 text-ink-2", google && "border-t border-line pt-3")}>No wallet extension found in this browser.</p>
        )}

        {missing.length ? (
          <section aria-label="Install a wallet" className="grid border-t border-line pt-3">
            {missing.map((i) => (
              <Row
                key={i.name}
                icon={<WalletIcon name={i.name} />}
                name={i.name}
                href={i.url}
                right={
                  <span className="small inline-flex items-center gap-1 text-ink-2">
                    Install <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
                  </span>
                }
              />
            ))}
          </section>
        ) : null}

        {IS_TEST_CLUSTER && burner ? (
          <section aria-label="Test wallet" className="grid gap-2 border-t border-line pt-3">
            <Row
              icon={
                <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-surface text-ink-2 ring-1 ring-line ring-inset">
                  <KeyRound className="size-4" strokeWidth={1.5} />
                </span>
              }
              name="Test wallet (this browser only)"
              right={<Chip tone="warn">{CLUSTER_LABEL[CLUSTER]}</Chip>}
              busy={connecting && picked === burner.adapter.name}
              onClick={() => choose(burner.adapter.name)}
            />
            <p className={cn("small mx-3 border-l-2 border-warn pl-3 text-ink-2")}>
              Its key is stored in this browser, unencrypted. Use it for {CLUSTER_LABEL[CLUSTER].toLowerCase()} testing only
              and never send it real funds.
            </p>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * Provides wallet-adapter-react-ui's `WalletModalContext`, so every existing
 * `useWalletModal().setVisible(true)` (lib/tx.tsx, pages) opens the Holdfast modal.
 */
export function WalletModalProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const value = useMemo(() => ({ visible, setVisible }), [visible]);
  // A failed Google round trip lands back here with `?auth_error=`: say so once and tidy the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("auth_error");
    if (code === null) return;
    url.searchParams.delete("auth_error");
    window.history.replaceState(window.history.state, "", url);
    window.sessionStorage.removeItem(EXPORT_AFTER_REAUTH_KEY);
    toast.error(Object.hasOwn(AUTH_ERRORS, code) ? AUTH_ERRORS[code] : AUTH_ERRORS.failed);
  }, []);
  return (
    <WalletModalContext.Provider value={value}>
      {children}
      <WalletModal open={visible} onOpenChange={setVisible} />
    </WalletModalContext.Provider>
  );
}
