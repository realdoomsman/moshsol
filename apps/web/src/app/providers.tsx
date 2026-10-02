"use client";

import {
  WalletReadyState,
  WalletSendTransactionError,
  WalletSignMessageError,
  WalletSignTransactionError,
  type Adapter,
  type WalletError,
} from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CommandPaletteProvider } from "@/components/search/command-palette";
import { WalletModalProvider } from "@/components/shell/wallet-modal";
import { AppToaster } from "@/components/ui/toast";
import { createBurner } from "@/lib/burner";
import { IS_TEST_CLUSTER, RPC_URL, WS_URL } from "@/lib/env";
import { GoogleWalletAdapter } from "@/lib/google-wallet";
import { ServerNowContext } from "@/lib/hooks";
import { LiveProvider } from "@/lib/live";
import { RESTORE_TIMEOUT_MS, rememberedWallet, restoreInFlight, restoreWallet } from "@/lib/wallet-restore";

/** Motion's features arrive in their own chunk after hydration (dialogs/indicators render `m.*`). */
const loadMotionFeatures = () => import("@/lib/motion-features").then((mod) => mod.default);

export function Providers({ now, children }: { now: number; children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 4_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  // Wallet Standard wallets (Phantom, Solflare, Backpack…) register themselves; Google (custodial,
  // every cluster) and the burner (test clusters only) are ours.
  const wallets = useMemo<Adapter[]>(
    () => (typeof window === "undefined" ? [] : [new GoogleWalletAdapter(), ...(IS_TEST_CLUSTER ? [createBurner()] : [])]),
    [],
  );
  // Sign/send errors are thrown to the caller too, which reports them in context (the transaction toast, the
  // comment or profile form); a second, sticky toast here would double every rejected signature. A failed page-load
  // reconnect isn't the user's doing either: the header just offers "Connect".
  const onError = useCallback((error: WalletError, adapter?: Adapter) => {
    if (error instanceof WalletSignTransactionError || error instanceof WalletSendTransactionError || error instanceof WalletSignMessageError) {
      return;
    }
    if (adapter && restoreInFlight(adapter)) return;
    toast.error("Your wallet reported an error", { description: error.message || error.name, duration: Infinity });
  }, []);

  // The wallet remembered from the last visit reconnects silently and bounded (lib/wallet-restore). Any other connect
  // is a wallet picked in the modal (the name differs, or the remembered one was forgotten first): the provider's
  // default, interactive and unbounded, since the user is looking at its popup.
  const [remembered] = useState(() => (typeof window === "undefined" ? null : rememberedWallet()));
  const autoConnect = useCallback(
    async (adapter: Adapter) => {
      if (adapter.name !== remembered || rememberedWallet() !== remembered) return true;
      await restoreWallet(adapter);
      return false;
    },
    [remembered],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ServerNowContext value={now}>
        <LazyMotion features={loadMotionFeatures} strict>
          <MotionConfig reducedMotion="user">
            <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed", wsEndpoint: WS_URL }}>
              <WalletProvider wallets={wallets} autoConnect={autoConnect} onError={onError}>
                <ForgetMissingWallet />
                <WalletModalProvider>
                  <LiveProvider>
                    <CommandPaletteProvider>{children}</CommandPaletteProvider>
                  </LiveProvider>
                </WalletModalProvider>
              </WalletProvider>
            </ConnectionProvider>
          </MotionConfig>
        </LazyMotion>
      </ServerNowContext>
      <AppToaster />
    </QueryClientProvider>
  );
}

/**
 * A remembered wallet that hasn't registered within the restore window (extension uninstalled or disabled, another
 * browser profile) is forgotten, so later visits don't treat it as signed in (the onboarding boot script reads it).
 */
function ForgetMissingWallet() {
  const { wallet, select } = useWallet();
  const ready = wallet?.readyState === WalletReadyState.Installed || wallet?.readyState === WalletReadyState.Loadable;
  useEffect(() => {
    if (ready || rememberedWallet() === null) return;
    const timer = window.setTimeout(() => select(null), RESTORE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [ready, select]);
  return null;
}
