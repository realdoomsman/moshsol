"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { UnsafeBurnerWalletAdapter } from "@solana/wallet-adapter-unsafe-burner";
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { Keypair } from "@solana/web3.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Toaster, toast } from "sonner";
import { IS_TEST_CLUSTER, RPC_URL, WS_URL } from "@/lib/env";
import { LiveProvider } from "@/lib/live";

const BURNER_STORAGE_KEY = "moshsol:burner-secret";

/**
 * The stock burner forgets its keypair on every reload, which makes a test session useless.
 * This keeps the same keypair in localStorage (test clusters only — see `IS_TEST_CLUSTER`).
 */
class PersistentBurnerWalletAdapter extends UnsafeBurnerWalletAdapter {
  override async connect(): Promise<void> {
    let keypair: Keypair | null = null;
    const stored = window.localStorage.getItem(BURNER_STORAGE_KEY);
    if (stored) {
      try {
        keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored) as number[]));
      } catch {
        window.localStorage.removeItem(BURNER_STORAGE_KEY);
      }
    }
    if (!keypair) {
      keypair = Keypair.generate();
      window.localStorage.setItem(BURNER_STORAGE_KEY, JSON.stringify(Array.from(keypair.secretKey)));
    }
    // The base class keeps its signer in a TS-private field; set it so signTransaction/signMessage work.
    (this as unknown as { _keypair: Keypair | null })._keypair = keypair;
    this.emit("connect", keypair.publicKey);
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 4_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  const wallets = useMemo<Adapter[]>(
    () => (IS_TEST_CLUSTER && typeof window !== "undefined" ? [new PersistentBurnerWalletAdapter()] : []),
    [],
  );
  const onError = useCallback((error: WalletError) => {
    toast.error("Wallet error", { description: error.message || error.name });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed", wsEndpoint: WS_URL }}>
        <WalletProvider wallets={wallets} autoConnect onError={onError}>
          <WalletModalProvider>
            <LiveProvider>{children}</LiveProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
      <Toaster theme="dark" position="bottom-right" richColors={false} closeButton toastOptions={{ className: "!rounded-xl" }} />
    </QueryClientProvider>
  );
}
