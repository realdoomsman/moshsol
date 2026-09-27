"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Input } from "../ui/input";
import { parseWallet } from "./wallet";

/** "Look up any wallet": validates the address and opens its read-only portfolio. */
export function WalletLookup({ label = "Look up any wallet", className }: { label?: string; className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const inputId = useId();

  return (
    <form
      role="search"
      className={cn("grid gap-1.5", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const wallet = parseWallet(value);
        if (!wallet) {
          setError("That isn't a Solana wallet address.");
          return;
        }
        setError(null);
        router.push(`/portfolio?wallet=${wallet}`);
      }}
    >
      <label htmlFor={inputId} className="label text-ink-3">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          prefix={<Search className="size-4" strokeWidth={1.5} aria-hidden />}
          placeholder="Wallet address"
          autoComplete="off"
          spellCheck={false}
          value={value}
          invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          className="min-w-0 flex-1 font-mono text-[13px]"
        />
        <Button type="submit" variant="secondary">
          Look up
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="small text-down">
          {error}
        </p>
      ) : null}
    </form>
  );
}
