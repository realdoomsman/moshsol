"use client";

import { shortAddr } from "@holdfast/sdk";
import { PublicKey } from "@solana/web3.js";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { fmtMcap } from "@/lib/format";
import { launchHref } from "@/lib/launch";
import { useDebounced } from "@/lib/hooks";
import { searchQuery } from "@/lib/query-options";
import type { SearchLaunch, SearchUser } from "@/lib/types";
import { StatusChip } from "../ui/chip";
import { cn } from "../ui/cn";
import { Dialog } from "../ui/dialog";
import { ErrorState } from "../ui/empty-state";
import { Identicon } from "../ui/identicon";
import { Spinner } from "../ui/spinner";
import { TokenAvatar } from "../ui/token-avatar";

interface PaletteContext {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const Ctx = createContext<PaletteContext>({ open: false, setOpen: () => undefined });

/** Open/close the command palette from anywhere (e.g. a docs search box). */
export function useCommandPalette(): PaletteContext {
  return useContext(Ctx);
}

const ACTIONS = [
  { label: "Discover launches", href: "/app" },
  { label: "Create a launch", href: "/create" },
  { label: "Go to portfolio", href: "/portfolio" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Vault agent transparency", href: "/agents" },
  { label: "Docs", href: "/docs" },
] as const;

/** A canonical 32-byte base58 public key (mint or wallet). */
function isAddress(s: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try {
    return new PublicKey(s).toBase58() === s;
  } catch {
    return false;
  }
}

/** A pasted address is a launch if the indexer knows it as a mint or launch address, otherwise a wallet. */
async function addressRoute(address: string): Promise<string> {
  try {
    const r = await api.search(address);
    const launch = r.launches.find((l) => l.mint === address || l.address === address);
    return launch ? launchHref(launch) : `/u/${address}`;
  } catch {
    return `/u/${address}`;
  }
}

type Item =
  | { kind: "address"; id: string; address: string }
  | { kind: "launch"; id: string; launch: SearchLaunch }
  | { kind: "user"; id: string; user: SearchUser }
  | { kind: "action"; id: string; label: string; href: string };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="py-1.5">
      <div className="label px-5 pt-2 pb-1.5 text-ink-3">{title}</div>
      {children}
    </div>
  );
}

function Palette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [jumping, setJumping] = useState(false);
  const q = query.trim();
  const debounced = useDebounced(q, 150);
  const search = useQuery({
    ...searchQuery(debounced),
    enabled: open && debounced.length >= 1 && debounced.length <= 64,
    placeholderData: keepPreviousData,
  });

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (isAddress(q)) out.push({ kind: "address", id: `address-${q}`, address: q });
    if (q && search.data && debounced === q) {
      for (const l of search.data.launches) out.push({ kind: "launch", id: `launch-${l.mint}`, launch: l });
      for (const u of search.data.users) out.push({ kind: "user", id: `user-${u.wallet}`, user: u });
    }
    const needle = q.toLowerCase();
    for (const a of ACTIONS) {
      if (!needle || a.label.toLowerCase().includes(needle)) out.push({ kind: "action", id: `action-${a.href}`, ...a });
    }
    return out;
  }, [q, debounced, search.data]);

  const safeActive = Math.min(active, Math.max(0, items.length - 1));

  const close = useCallback(() => {
    onOpenChange(false);
    setQuery("");
    setActive(0);
  }, [onOpenChange]);

  const go = async (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "address") {
      setJumping(true);
      const href = await addressRoute(item.address);
      setJumping(false);
      router.push(href);
    } else {
      router.push(item.kind === "launch" ? launchHref(item.launch) : item.kind === "user" ? `/u/${item.user.wallet}` : item.href);
    }
    close();
  };

  const optionId = (i: number) => `${listId}-${i}`;
  let index = -1;
  const option = (item: Item, body: ReactNode) => {
    index += 1;
    const i = index;
    const selected = i === safeActive;
    return (
      <div
        key={item.id}
        id={optionId(i)}
        role="option"
        aria-selected={selected}
        onPointerMove={() => i !== safeActive && setActive(i)}
        onClick={() => void go(item)}
        className={cn(
          "mx-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-sm px-3 py-2 transition-colors",
          selected ? "bg-ink/[0.07]" : "hover:bg-ink/[0.04]",
        )}
      >
        {body}
      </div>
    );
  };

  const launches = items.filter((i): i is Extract<Item, { kind: "launch" }> => i.kind === "launch");
  const users = items.filter((i): i is Extract<Item, { kind: "user" }> => i.kind === "user");
  const actions = items.filter((i): i is Extract<Item, { kind: "action" }> => i.kind === "action");
  const address = items.find((i): i is Extract<Item, { kind: "address" }> => i.kind === "address");
  const settled = debounced === q && !search.isFetching;
  const noMatches = !!q && settled && !search.isError && search.data && !launches.length && !users.length && !address;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title="Search"
      width={640}
      top="15vh"
      mobile="fullscreen"
      initialFocus={inputRef}
      header={
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
          <Search className="size-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items.length ? optionId(safeActive) : undefined}
            aria-label="Search tokens, wallets and actions"
            placeholder="Search tokens, wallets…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text").trim();
              if (!isAddress(text)) return;
              e.preventDefault();
              setQuery(text);
              void go({ kind: "address", id: text, address: text });
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = items.length || 1;
                setActive((safeActive + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
                document.getElementById(optionId((safeActive + (e.key === "ArrowDown" ? 1 : -1) + n) % n))?.scrollIntoView({
                  block: "nearest",
                });
              } else if (e.key === "Enter") {
                e.preventDefault();
                void go(items[safeActive]);
              }
            }}
            className="ui h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
          {search.isFetching || jumping ? <Spinner className="text-ink-3" label="Searching" /> : null}
          <button
            type="button"
            onClick={close}
            className="micro shrink-0 rounded-xs border border-line-2 px-1.5 py-0.5 text-ink-3 transition-colors hover:text-ink"
          >
            Esc
          </button>
        </div>
      }
    >
      <div id={listId} role="listbox" aria-label="Results" className="pb-2">
        {address
          ? option(
              address,
              <>
                <ArrowRight className="size-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
                <span className="ui text-ink">Open address</span>
                <span className="mono truncate text-ink-2">{shortAddr(address.address, 6)}</span>
              </>,
            )
          : null}
        {search.isError && q ? (
          <div className="px-5 pt-3">
            <ErrorState onRetry={() => void search.refetch()}>Search is unavailable. The indexer didn&apos;t answer.</ErrorState>
          </div>
        ) : null}
        {launches.length ? (
          <Section title="Launches">
            {launches.map((item) =>
              option(
                item,
                <>
                  <TokenAvatar src={item.launch.image} symbol={item.launch.symbol} mint={item.launch.mint} size={32} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="ui text-ink">{item.launch.name}</span>{" "}
                    <span className="ui text-ink-3">${item.launch.symbol}</span>
                  </span>
                  <span className="small num hidden text-ink-2 sm:inline">{fmtMcap(item.launch)}</span>
                  <StatusChip status={item.launch.status} />
                </>,
              ),
            )}
          </Section>
        ) : null}
        {users.length ? (
          <Section title="Wallets">
            {users.map((item) =>
              option(
                item,
                <>
                  <Identicon address={item.user.wallet} src={item.user.avatar} size={24} />
                  <span className="min-w-0 flex-1 truncate">
                    {item.user.name ? <span className="ui text-ink">{item.user.name}</span> : null}{" "}
                    <span className="mono text-ink-3">{shortAddr(item.user.wallet)}</span>
                  </span>
                </>,
              ),
            )}
          </Section>
        ) : null}
        {noMatches ? (
          <p className="body px-5 pt-4 pb-2 text-ink-2">
            No launches or wallets match &ldquo;{q}&rdquo;. Paste a full address to jump to it.
          </p>
        ) : null}
        {!q ? (
          <p className="small px-5 pt-4 text-ink-3">
            Search launches by name, ticker or mint, and wallets by name or address. Paste an address to jump straight to it.
          </p>
        ) : null}
        {actions.length ? (
          <Section title="Actions">
            {actions.map((item) =>
              option(
                item,
                <>
                  <ArrowRight className="size-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
                  <span className="ui text-ink">{item.label}</span>
                </>,
              ),
            )}
          </Section>
        ) : null}
      </div>
    </Dialog>
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/**
 * Command palette (§4.3, #7): ⌘K / Ctrl+K anywhere, `/` when not typing. Launches (image, name,
 * ticker, mcap, status) and wallets from `GET /api/search`, plus navigation actions; arrow keys +
 * Enter. Pasting a mint jumps to `/launch/<mint>`, any other address to `/u/<wallet>`.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Palette open={open} onOpenChange={setOpen} />
    </Ctx.Provider>
  );
}
