"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { Fragment, useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { useFallbackInterval } from "@/lib/live";
import { COMMENTS_PAGE, commentsQuery } from "@/lib/query-options";
import { signedMessage } from "@/lib/signed";
import type { Comment, CommentsPage, LaunchSummary } from "@/lib/types";
import { Address } from "../ui/address";
import { Button } from "../ui/button";
import { RoleChip } from "../ui/chip";
import { cn } from "../ui/cn";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { Identicon } from "../ui/identicon";
import { Textarea } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { LoadMore } from "../ui/table";
import { WalletPeekCard } from "../wallet-peek/wallet-peek";
import { RelativeTime, shareDetail, useFreshKeys, type LaunchRoles } from "./shared";

const BODY_MAX = 500;
const URL_RE = /(https?:\/\/[^\s<>"]+)/g;

/** Plain-text body with http(s) links made clickable (no images, no HTML). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return parts.map((part, i) => {
    if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
    // Sentence punctuation after a link isn't part of it.
    const m = /^(.*?)([.,;:!?)\]]*)$/.exec(part);
    const href = m?.[1] ?? part;
    return (
      <Fragment key={i}>
        <a
          href={href}
          target="_blank"
          rel="noreferrer nofollow ugc"
          className="break-all text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink"
        >
          {href}
        </a>
        {m?.[2]}
      </Fragment>
    );
  });
}

/** Adds a just-posted comment to the cached head page (the websocket echo is then a no-op). */
function insertComment(old: CommentsPage | undefined, c: Comment): CommentsPage | undefined {
  if (!old || old.comments.some((x) => x.id === c.id)) return old;
  return {
    ...old,
    total: old.total + 1,
    comments: [c, ...old.comments.map((x) => (x.id === c.replyTo ? { ...x, replyCount: x.replyCount + 1 } : x))],
  };
}

interface Older {
  mint: string;
  comments: Comment[];
  exhausted: boolean;
}

/** The thread: live head page (patched by the websocket) plus older pages by comment-id cursor. */
function useThread(mint: string) {
  const interval = useFallbackInterval(15_000);
  const head = useQuery({ ...commentsQuery(mint), refetchInterval: interval });
  const [older, setOlder] = useState<Older>({ mint, comments: [], exhausted: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mine = older.mint === mint ? older : { mint, comments: [] as Comment[], exhausted: false };

  const comments = useMemo(() => {
    const seen = new Set<number>();
    const out: Comment[] = [];
    for (const c of [...(head.data?.comments ?? []), ...mine.comments]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }, [head.data, mine.comments]);

  const cursor = mine.comments.length ? (mine.comments.at(-1)?.id ?? null) : (head.data?.nextBefore ?? null);
  const hasMore = !mine.exhausted && cursor !== null && (head.data?.nextBefore ?? null) !== null;

  const loadMore = useCallback(() => {
    if (loadingMore || cursor === null) return;
    setLoadingMore(true);
    setLoadError(null);
    void api
      .comments(mint, { limit: COMMENTS_PAGE, before: cursor })
      .then((page) =>
        setOlder((cur) => ({
          mint,
          comments: [...(cur.mint === mint ? cur.comments : []), ...page.comments],
          exhausted: page.nextBefore === null,
        })),
      )
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, mint]);

  return { head, comments, hasMore, loadMore, loadingMore, loadError };
}

function Badges({ c, roles }: { c: Comment; roles: LaunchRoles }) {
  const share = roles.shares.get(c.wallet);
  return (
    <>
      {c.isCreator ? <RoleChip role="creator" /> : null}
      {c.isBacker ? <RoleChip role="backer" detail={share !== undefined ? shareDetail(share) : undefined} /> : null}
      {c.holdsTokens ? <RoleChip role="holder" /> : null}
    </>
  );
}

function Composer({
  launch: l,
  replyTo,
  placeholder,
  autoFocus,
  onPosted,
  onCancel,
}: {
  launch: LaunchSummary;
  replyTo?: number;
  placeholder: string;
  autoFocus?: boolean;
  onPosted?: () => void;
  onCancel?: () => void;
}) {
  const { publicKey, signMessage } = useWallet();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "signing" | "posting">("idle");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const text = body.trim();
  const over = body.length > BODY_MAX;

  const post = async () => {
    if (!publicKey || !text || over) return;
    if (!signMessage) {
      setError("This wallet can't sign messages. Connect one that can (Phantom, Solflare, Backpack).");
      return;
    }
    setError(null);
    setState("signing");
    try {
      const signed = await signedMessage("comment", l.mint, text, signMessage);
      setState("posting");
      const { comment } = await api.postComment(l.mint, {
        wallet: publicKey.toBase58(),
        ...signed,
        body: text,
        ...(replyTo !== undefined ? { replyTo } : {}),
      });
      qc.setQueryData<CommentsPage>(["comments", l.mint, "head"], (old) => insertComment(old, comment));
      if (replyTo !== undefined) void qc.invalidateQueries({ queryKey: ["comments", l.mint, "replies"] });
      void qc.invalidateQueries({ queryKey: ["launch", l.mint], exact: true });
      setBody("");
      onPosted?.();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setError(/reject|declin|cancel/i.test(msg) ? "Signature request was declined. Nothing was posted." : `Couldn't post: ${msg}.`);
    } finally {
      setState("idle");
    }
  };

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void post();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <Textarea
        id={id}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={replyTo !== undefined ? 2 : 3}
        invalid={over}
        className="min-h-0"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void post();
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("small num", over ? "text-down" : "text-ink-3")}>
          {error ? <span className="text-down">{error}</span> : `Sign to post: free, no transaction · ${body.length}/${BODY_MAX}`}
        </span>
        <span className="flex items-center gap-2">
          {onCancel ? (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" size="sm" variant="primary" disabled={!text || over} busy={state !== "idle"}>
            {state === "signing" ? "Sign in wallet" : state === "posting" ? "Posting" : replyTo !== undefined ? "Reply" : "Post"}
          </Button>
        </span>
      </div>
    </form>
  );
}

function CommentItem({
  c,
  roles,
  now,
  fresh,
  reply,
  children,
}: {
  c: Comment;
  roles: LaunchRoles;
  now: number;
  fresh: boolean;
  reply?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className={cn("grid grid-cols-[32px_minmax(0,1fr)] gap-x-3", fresh && "animate-pop-in")} aria-label={`Comment by ${c.name ?? c.wallet}`}>
      <Identicon address={c.wallet} src={c.avatar} size={32} />
      <div className="min-w-0">
        <div className="small flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Address
            address={c.wallet}
            label={c.name ?? undefined}
            copy={false}
            explorer={false}
            peek={<WalletPeekCard wallet={c.wallet} />}
            className="[font-weight:560] text-ink"
          />
          <Badges c={c} roles={roles} />
          <RelativeTime ts={c.createdAt} now={now} className="text-ink-3" />
        </div>
        <p className="body mt-1 whitespace-pre-line text-pretty break-words text-ink">
          <Linkified text={c.body} />
        </p>
        {reply}
        {children}
      </div>
    </article>
  );
}

/**
 * Thread tab (§4.5, pump.fun callouts with receipts): signed comments (free — a message signature,
 * no transaction), creator/backer/holder receipt badges, one level of replies, newest first, live
 * over the indexer websocket.
 */
export function Thread({ launch: l, roles, now }: { launch: LaunchSummary; roles: LaunchRoles; now: number }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const t = useThread(l.mint);
  const [replying, setReplying] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const fresh = useFreshKeys(t.head.data?.comments.map((c) => String(c.id)));

  const expandedReplies = useQuery({
    queryKey: ["comments", l.mint, "replies", "expanded", [...expanded].sort().join(",")],
    enabled: expanded.size > 0,
    queryFn: async () => (await Promise.all([...expanded].map((id) => api.comments(l.mint, { limit: 200, replyTo: id })))).flatMap((p) => p.comments),
  });

  const { roots, replies } = useMemo(() => {
    const all = new Map<number, Comment>();
    for (const c of [...t.comments, ...(expandedReplies.data ?? [])]) all.set(c.id, c);
    const byParent = new Map<number, Comment[]>();
    const top: Comment[] = [];
    for (const c of all.values()) {
      if (c.replyTo !== null && all.has(c.replyTo)) {
        const list = byParent.get(c.replyTo) ?? [];
        list.push(c);
        byParent.set(c.replyTo, list);
      } else {
        top.push(c);
      }
    }
    top.sort((a, b) => b.id - a.id);
    for (const list of byParent.values()) list.sort((a, b) => a.id - b.id);
    return { roots: top, replies: byParent };
  }, [t.comments, expandedReplies.data]);

  const total = t.head.data?.total ?? l.comments;

  return (
    <div className="grid gap-5 px-4 pb-4">
      {publicKey ? (
        <Composer launch={l} placeholder={`Say something about $${l.symbol}`} />
      ) : (
        <div className="small flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line px-3 py-2.5 text-ink-2">
          <span>Connect a wallet to post. Signing a comment is free, no transaction.</span>
          <Button size="sm" variant="secondary" onClick={() => setVisible(true)}>
            Connect wallet
          </Button>
        </div>
      )}

      {t.head.error && !t.head.data ? (
        <ErrorState onRetry={() => void t.head.refetch()} retrying={t.head.isFetching}>
          Couldn&apos;t load the thread. {t.head.error.message}
        </ErrorState>
      ) : t.head.isLoading ? (
        <div className="grid gap-4" aria-hidden>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="grid grid-cols-[32px_1fr] gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="grid gap-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : roots.length === 0 ? (
        <EmptyState className="py-8">No comments yet. Start the thread: backers and holders get a receipt badge.</EmptyState>
      ) : (
        <div className="grid gap-5" aria-label={`${total} comments`}>
          {roots.map((c) => {
            const kids = replies.get(c.id) ?? [];
            const hidden = c.replyCount - kids.length;
            return (
              <CommentItem
                key={c.id}
                c={c}
                roles={roles}
                now={now}
                fresh={fresh.has(String(c.id))}
                reply={
                  <div className="mt-1 flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="-ml-3"
                      icon={<MessageSquare className="size-4" strokeWidth={1.5} aria-hidden />}
                      onClick={() => (publicKey ? setReplying(replying === c.id ? null : c.id) : setVisible(true))}
                    >
                      Reply{c.replyCount ? ` · ${c.replyCount}` : ""}
                    </Button>
                    {hidden > 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        busy={expandedReplies.isFetching && expanded.has(c.id)}
                        onClick={() => setExpanded(new Set([...expanded, c.id]))}
                      >
                        Show {hidden} more repl{hidden === 1 ? "y" : "ies"}
                      </Button>
                    ) : null}
                  </div>
                }
              >
                {kids.length || replying === c.id ? (
                  <div className="mt-3 grid gap-4 border-l border-line pl-4">
                    {kids.map((r) => (
                      <CommentItem key={r.id} c={r} roles={roles} now={now} fresh={fresh.has(String(r.id))} />
                    ))}
                    {replying === c.id ? (
                      <Composer
                        launch={l}
                        replyTo={c.id}
                        autoFocus
                        placeholder={`Reply to ${c.name ?? `${c.wallet.slice(0, 4)}…${c.wallet.slice(-4)}`}`}
                        onPosted={() => setReplying(null)}
                        onCancel={() => setReplying(null)}
                      />
                    ) : null}
                  </div>
                ) : null}
              </CommentItem>
            );
          })}
          {t.loadError ? (
            <ErrorState onRetry={t.loadMore} retrying={t.loadingMore}>
              Couldn&apos;t load older comments. {t.loadError}
            </ErrorState>
          ) : (
            <LoadMore hasMore={t.hasMore} loading={t.loadingMore} onLoadMore={t.loadMore} />
          )}
        </div>
      )}
    </div>
  );
}
