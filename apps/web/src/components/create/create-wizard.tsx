"use client";

import { buildWhitelist, LIMITS, OPEN_WHITELIST_ROOT, timeAgo } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Keypair } from "@solana/web3.js";
import { Eye } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMoshClient, useSolBalance } from "@/lib/chain";
import { fmtLamports } from "@/lib/format";
import { usePlatform } from "@/lib/queries";
import { TX_STAGE_LABEL, useTx } from "@/lib/tx";
import { FaucetButton } from "../shell/faucet";
import { Button } from "../ui/button";
import { Sheet } from "../ui/dialog";
import { clearDraft, isBlankDraft, loadDraft, saveDraft, type RestoredDraft } from "./draft";
import { prepareTokenImage } from "./image";
import { useObjectUrl } from "./image-drop";
import { bundleRange, useCreateCost } from "./math";
import { CostSummary, DraftCard, PreviewPanel } from "./preview";
import { StepProgress, Stepper } from "./stepper";
import { StepRaise, StepReview, StepToken, StepVault, type StepContext } from "./steps";
import {
  durationSecsOf,
  fmtDuration,
  INITIAL_DRAFT,
  stepOf,
  STEPS,
  utf8Len,
  validateDraft,
  type CreateDraft,
  type CreatePrefill,
  type DraftField,
  type StepIndex,
} from "./validate";

const AUTOSAVE_MS = 400;
const NO_STEPS_SHOWN = [false, false, false, false];

/**
 * Create wizard (§4.6): stepper · form · sticky live preview on desktop; a progress bar, a
 * Preview sheet and a sticky Back/Continue bar on smaller screens. The draft autosaves to
 * localStorage and is offered back with "Resume draft?". Chain logic (metadata upload, one
 * `create_launch` transaction signed with a fresh mint keypair) is unchanged from the old form.
 */
export function CreateWizard({ prefill }: { prefill: CreatePrefill }) {
  const router = useRouter();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMoshClient();
  const platform = usePlatform();
  const balance = useSolBalance(publicKey);
  const tx = useTx();
  const params = platform.data?.params;

  const [draft, setDraft] = useState<CreateDraft>(() => ({ ...INITIAL_DRAFT, ...prefill }));
  const [step, setStep] = useState<StepIndex>(0);
  const [visited, setVisited] = useState<StepIndex>(0);
  const [touched, setTouched] = useState<Partial<Record<DraftField, boolean>>>({});
  /** Steps whose Continue was pressed: all their errors show, touched or not. */
  const [shown, setShown] = useState<boolean[]>(NO_STEPS_SHOWN);
  const [pending, setPending] = useState<RestoredDraft | null>(null);
  const [autosave, setAutosave] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  // Offer a saved draft back once, before autosave may overwrite it.
  useEffect(() => {
    let cancelled = false;
    void loadDraft().then((saved) => {
      if (cancelled) return;
      if (saved && !isBlankDraft(saved.draft)) setPending(saved);
      else setAutosave(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!autosave) return;
    const id = window.setTimeout(() => {
      if (isBlankDraft(draft) && visited === 0) clearDraft();
      else void saveDraft({ draft, step, visited });
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(id);
  }, [autosave, draft, step, visited]);

  const imageUrl = useObjectUrl(draft.image?.file);
  const minRaiseLamports = params ? BigInt(params.minRaiseLamports) : null;
  // Beta caps ("0" = none).
  const maxRaiseCap = params?.maxRaiseLamports ?? "0";
  const maxWalletCap = params?.maxWalletDepositLamports ?? "0";
  const v = useMemo(
    () =>
      validateDraft(draft, {
        creator: publicKey,
        // Until /api/platform loads, the raise minimum can't be checked; min 1 lamport keeps the rest honest.
        minRaiseLamports: minRaiseLamports ?? 1n,
        maxBundleSupplyBps: params?.maxBundleSupplyBps ?? LIMITS.minBundleSupplyBps,
        maxRaiseLamports: BigInt(maxRaiseCap),
        maxWalletDepositLamports: BigInt(maxWalletCap),
      }),
    [draft, publicKey, minRaiseLamports, params?.maxBundleSupplyBps, maxRaiseCap, maxWalletCap],
  );
  const range = useMemo(() => bundleRange(params, draft), [params, draft]);
  const cost = useCreateCost(draft.name, draft.symbol, params);
  const durationSecs = durationSecsOf(draft);

  const set = useCallback(<K extends keyof CreateDraft>(key: K, value: CreateDraft[K], field?: DraftField) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (field) setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  }, []);

  const err = (f: DraftField) => (touched[f] || shown[stepOf(f)] ? (v.errors[f] ?? null) : null);
  const ctx: StepContext = { draft, set, err, v, params };
  const invalidSteps = STEPS.map((s) => (s.fields as readonly DraftField[]).some((f) => v.errors[f]));

  const onImage = async (file: File | null) => {
    setImageError(null);
    if (!file) {
      set("image", null, "image");
      return;
    }
    setImageBusy(true);
    try {
      set("image", await prepareTokenImage(file), "image");
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "This file couldn't be read as an image");
    } finally {
      setImageBusy(false);
    }
  };

  const go = (next: StepIndex) => {
    setStep(next);
    setVisited((cur) => (next > cur ? next : cur));
    setPreviewOpen(false);
    requestAnimationFrame(() => {
      const el = top.current;
      if (!el) return;
      if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
      el.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    });
  };

  const focusFirstInvalid = () =>
    requestAnimationFrame(() => {
      const first = top.current?.querySelector<HTMLElement>(":is(input, textarea, button)[aria-invalid='true']");
      first?.scrollIntoView({ block: "center" });
      first?.focus({ preventScroll: true });
    });

  const next = () => {
    if (step === 3) return;
    if (step === 0 && imageBusy) return;
    if (invalidSteps[step] || (step === 0 && imageError)) {
      setShown((s) => s.map((x, i) => x || i === step));
      focusFirstInvalid();
      return;
    }
    go((step + 1) as StepIndex);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || t.tagName !== "INPUT") return;
    e.preventDefault();
    next();
  };

  const resume = () => {
    if (!pending) return;
    setDraft(pending.draft);
    setStep(pending.step);
    setVisited(pending.visited);
    if (pending.imageDropped) setImageError("The image was too large to keep in the draft. Add it again.");
    setPending(null);
    setAutosave(true);
  };

  const startOver = () => {
    clearDraft();
    setPending(null);
    setAutosave(true);
  };

  const paused = !!params?.paused;
  const insufficient = balance.data !== undefined && cost.total !== null && balance.data < cost.total;
  const busy = uploading || tx.pending !== null;

  const create = async () => {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    if (!v.parsed || imageError) {
      setShown([true, true, true, true]);
      const firstBad = invalidSteps.findIndex(Boolean);
      go((firstBad === -1 ? 0 : firstBad) as StepIndex);
      focusFirstInvalid();
      return;
    }
    const d = v.parsed;
    setUploading(true);
    let uri: string;
    try {
      ({ uri } = await api.upload({
        image: d.image,
        name: d.name,
        symbol: d.symbol,
        description: d.description || undefined,
        twitter: d.twitter,
        telegram: d.telegram,
        website: d.website,
        whitelist: d.whitelist?.map((k) => k.toBase58()),
      }));
    } catch (e) {
      toast.error("Metadata upload failed", { description: e instanceof Error ? e.message : String(e) });
      return;
    } finally {
      setUploading(false);
    }
    if (utf8Len(uri) > LIMITS.maxUriLen) {
      toast.error("Metadata upload failed", { description: `Metadata URI exceeds ${LIMITS.maxUriLen} bytes` });
      return;
    }

    const mint = Keypair.generate();
    const signature = await tx.run({
      label: `Create $${d.symbol}`,
      successMessage: `$${d.symbol} raise is open`,
      signers: [mint],
      build: async (payer) => {
        const onChain = await client.fetchPlatform();
        if (!onChain) throw new Error("Platform is not initialized on this cluster");
        if (!params) throw new Error("Platform terms are still loading");
        return [
          await client.createLaunchIx({
            creator: payer,
            mint: mint.publicKey,
            feeRecipient: onChain.feeRecipient,
            name: d.name,
            symbol: d.symbol,
            uri,
            raiseMin: d.raiseMin,
            raiseMax: d.raiseMax,
            maxPerWallet: d.maxPerWallet,
            durationSecs: d.durationSecs,
            whitelistRoot: d.whitelist ? buildWhitelist(d.whitelist).root : OPEN_WHITELIST_ROOT,
            bundleSupplyBps: d.bundleSupplyBps,
            reserveBps: d.reserveBps,
            // The terms shown in this wizard; the program refuses the launch if they changed.
            terms: params,
          }),
        ];
      },
    });
    if (!signature) {
      // `TermsChanged` (or anything else): reload the platform terms so the next attempt carries current ones.
      void platform.refetch();
      return;
    }
    setAutosave(false);
    clearDraft();
    router.replace(`/create?launched=${mint.publicKey.toBase58()}&tx=${signature}`);
  };

  const summaries = [
    draft.symbol ? `$${draft.symbol}${draft.name.trim() ? ` · ${draft.name.trim()}` : ""}` : null,
    draft.raiseMin && draft.raiseMax
      ? `${draft.raiseMin}–${draft.raiseMax} SOL${durationSecs ? ` · ${fmtDuration(durationSecs)}` : ""}`
      : null,
    `≤ ${draft.bundlePct}% · ${draft.reservePct}% reserve · ${draft.access === "self" ? "self-funded" : draft.access}`,
    null,
  ];

  const costSummary = <CostSummary cost={cost} balance={balance.data} connected={!!publicKey} />;
  const preview = (
    <PreviewPanel
      card={<DraftCard draft={draft} imageUrl={imageUrl} creator={publicKey?.toBase58() ?? null} durationSecs={durationSecs} />}
      range={range}
      loading={platform.isLoading}
      cost={costSummary}
    />
  );

  const ctaLabel = !publicKey
    ? "Connect wallet to create"
    : paused
      ? "Platform is paused"
      : uploading
        ? "Uploading metadata"
        : tx.stage
          ? TX_STAGE_LABEL[tx.stage]
          : "Create launch · sign 1 transaction";

  const action = (
    <div className="grid gap-3">
      <Button
        variant="accent"
        size="lg"
        className="w-full"
        busy={busy}
        disabled={!!publicKey && (paused || insufficient)}
        onClick={() => void create()}
      >
        {ctaLabel}
      </Button>
      {insufficient && cost.total !== null && balance.data !== undefined ? (
        <div className="small flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-warn">
          <span>
            Creating needs ≈ {fmtLamports(cost.total)} SOL; your balance is {fmtLamports(balance.data)} SOL.
          </span>
          <FaucetButton />
        </div>
      ) : (
        <p className="small text-center text-ink-3">
          One transaction creates the mint, revokes its mint authority and opens the raise.
        </p>
      )}
    </div>
  );

  const stepBody =
    step === 0 ? (
      <StepToken ctx={ctx} imageUrl={imageUrl} imageBusy={imageBusy} imageError={imageError} onImage={(f) => void onImage(f)} />
    ) : step === 1 ? (
      <StepRaise ctx={ctx} />
    ) : step === 2 ? (
      <StepVault ctx={ctx} range={range} wallet={publicKey} />
    ) : (
      <StepReview ctx={ctx} imageUrl={imageUrl} onEdit={go} cost={costSummary} action={action} />
    );

  const back = step > 0 ? (
    <Button variant="secondary" onClick={() => go((step - 1) as StepIndex)}>
      Back
    </Button>
  ) : (
    <span />
  );
  const cont =
    step < 3 ? (
      <Button variant="primary" arrow busy={step === 0 && imageBusy} onClick={next}>
        Continue
      </Button>
    ) : null;

  return (
    <div className="grid gap-6 pb-16 lg:pb-0">
      <header className="grid gap-1">
        <h1 className="display-m text-ink">Create a launch</h1>
        <p className="body text-ink-2">
          Open a raise. When it closes, the pooled SOL buys the first slice of supply and holds it in the launch&rsquo;s vault.{" "}
          <Link href="/docs/how-it-works" className="whitespace-nowrap text-ink underline decoration-ink-3/60 underline-offset-2 hover:decoration-ink">
            How it works ›
          </Link>
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[200px_minmax(0,1fr)_320px] lg:gap-8 xl:grid-cols-[240px_minmax(0,1fr)_380px] xl:gap-12">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Stepper step={step} visited={visited} summaries={summaries} invalid={invalidSteps} onStep={go} />
        </aside>

        <div ref={top} className="grid min-w-0 scroll-mt-20 gap-6 lg:max-w-[560px]" onKeyDown={onKeyDown}>
          <div className="flex items-center justify-between gap-4 lg:hidden">
            <div className="grid flex-1 gap-2">
              <StepProgress step={step} />
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<Eye className="size-4" strokeWidth={1.5} aria-hidden />}
              onClick={() => setPreviewOpen(true)}
            >
              Preview
            </Button>
          </div>

          {pending ? (
            <div
              role="region"
              aria-label="Saved draft"
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3"
            >
              <p className="small min-w-0 text-ink-2">
                <span className="ui text-ink">Resume draft?</span>{" "}
                {pending.draft.symbol ? `$${pending.draft.symbol} · ` : ""}saved {timeAgo(pending.savedAt)}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={startOver}>
                  Start over
                </Button>
                <Button size="sm" variant="primary" onClick={resume}>
                  Resume draft
                </Button>
              </div>
            </div>
          ) : null}

          {stepBody}

          <div className="hidden items-center justify-between gap-3 border-t border-line pt-6 lg:flex">
            {back}
            {cont}
          </div>
        </div>

        <aside aria-label="Live preview" className="hidden lg:sticky lg:top-20 lg:block">
          {preview}
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface md:bottom-8 lg:hidden">
        <div className="frame-app flex h-16 items-center justify-between gap-3">
          {back}
          {cont ?? (
            <Button size="sm" variant="ghost" onClick={() => setPreviewOpen(true)}>
              Preview
            </Button>
          )}
        </div>
      </div>

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen} title="Preview">
        <div className="px-5 pb-6">{preview}</div>
      </Sheet>
    </div>
  );
}
