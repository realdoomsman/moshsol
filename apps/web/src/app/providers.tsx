"use client";

import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CommandPaletteProvider } from "@/components/search/command-palette";
import { WalletModalProvider } from "@/components/shell/wallet-modal";
import { AppToaster } from "@/components/ui/toast";
import { createBurner } from "@/lib/burner";
import { IS_TEST_CLUSTER, RPC_URL, WS_URL } from "@/lib/env";
import { ServerNowContext } from "@/lib/hooks";
import { LiveProvider } from "@/lib/live";

export function Providers({ now, children }: { now: number; children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 4_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  // Wallet Standard wallets (Phantom, Solflare, Backpack…) register themselves; the burner is ours.
  const wallets = useMemo<Adapter[]>(() => (IS_TEST_CLUSTER && typeof window !== "undefined" ? [createBurner()] : []), []);
  const onError = useCallback((error: WalletError) => {
    toast.error("Your wallet reported an error", { description: error.message || error.name, duration: Infinity });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ServerNowContext value={now}>
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
      </ServerNowContext>
      <AppToaster />
    </QueryClientProvider>
  );
}
