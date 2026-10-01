"use client";

import {
  WalletSendTransactionError,
  WalletSignMessageError,
  WalletSignTransactionError,
  type Adapter,
  type WalletError,
} from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion, MotionConfig } from "motion/react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CommandPaletteProvider } from "@/components/search/command-palette";
import { WalletModalProvider } from "@/components/shell/wallet-modal";
import { AppToaster } from "@/components/ui/toast";
import { createBurner } from "@/lib/burner";
import { IS_TEST_CLUSTER, RPC_URL, WS_URL } from "@/lib/env";
import { GoogleWalletAdapter } from "@/lib/google-wallet";
import { ServerNowContext } from "@/lib/hooks";
import { LiveProvider } from "@/lib/live";

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
  // comment or profile form); a second, sticky toast here would double every rejected signature.
  const onError = useCallback((error: WalletError) => {
    if (error instanceof WalletSignTransactionError || error instanceof WalletSendTransactionError || error instanceof WalletSignMessageError) {
      return;
    }
    toast.error("Your wallet reported an error", { description: error.message || error.name, duration: Infinity });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ServerNowContext value={now}>
        <LazyMotion features={loadMotionFeatures} strict>
          <MotionConfig reducedMotion="user">
            <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed", wsEndpoint: WS_URL }}>
              <WalletProvider wallets={wallets} autoConnect onError={onError}>
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
