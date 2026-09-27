"use client";

import {
  LIMITS,
  buildWhitelist,
  fmtPrice,
  lamportsToSol,
  OPEN_WHITELIST_ROOT,
  previewBundle,
  TOTAL_SUPPLY,
  type BundlePreview,
} from "@holdfast/sdk";
import { ACCOUNT_SIZE, ExtensionType, getMintLen } from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Keypair } from "@solana/web3.js";
import { AtSign, Clock, Globe, Lock, Rocket, Send, ShieldCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMoshClient, useSolBalance } from "@/lib/chain";
import { INDEXER_URL } from "@/lib/env";
import { fmtLamports, fmtSolValue, fmtTokens } from "@/lib/format";
import { usePlatform } from "@/lib/queries";
import { useTx } from "@/lib/tx";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Hint, Segmented, TokenAvatar } from "../ui/interactive";
import { Badge, Card, CardHeader, Row, Skeleton } from "../ui/primitives";
import { PhasePill } from "../ui/status";
import { RaiseBar } from "../launch/raise-bar";
import { AmountInput, Field, Section } from "./field";
import { ImageDrop } from "./image-drop";
import {
  DURATION_PRESETS,
  durationSecsOf,
  MAX_DESCRIPTION,
  validateDraft,
  type CreateDraft,
  type DraftField,
} from "./validate";

const INITIAL: CreateDraft = {
  name: "",
  symbol: "",
  description: "",
  image: null,
  twitter: "",
  telegram: "",
  website: "",
  raiseMin: "5",
  raiseMax: "20",
  perWallet: "",
  duration: "1h",
  customValue: "30",
  customUnit: "m",
  bundlePct: 15,
  reservePct: 30,
  whitelistOn: false,
  whitelistText: "",
};

/** Transaction fee headroom on top of rent + create fee. */
const TX_FEE_LAMPORTS = 10_000n;

function fmtDuration(secs: number): string {
  if (secs >= 86_400) return `${+(secs / 86_400).toFixed(1)} day${secs === 86_400 ? "" : "s"}`;
  if (secs >= 3_600) return `${+(secs / 3_600).toFixed(1)} hour${secs === 3_600 ? "" : "s"}`;
  return `${Math.round(secs / 60)} min`;
}

/**
 * Rent for the launch, mint (+ on-mint metadata TLV) and the curve/vault token accounts.
 * Rent-exempt minimum is `(len + 128) * 3480 * 2` lamports on every Solana cluster, so this is
 * computed locally instead of spending public-RPC quota on getMinimumBalanceForRentExemption.
 */
function useCreateRent(nameLen: number, symbolLen: number): bigint {
  const client = useMoshClient();
  return useMemo(() => {
    // The metadata URI is only known after upload; the indexer issues `${INDEXER_URL}/files/meta/<id>.json`.
    const uriLen = `${INDEXER_URL}/files/meta/`.length + 40;
    const metadataLen = 4 + 32 + 32 + 4 * 4 + nameLen + symbolLen + uriLen;
    const sizes = [
      client.program.account.launch.size,
      getMintLen([ExtensionType.MetadataPointer]) + metadataLen,
      ACCOUNT_SIZE,
      ACCOUNT_SIZE,
    ];
    return sizes.reduce((sum, len) => sum + BigInt((len + 128) * 3480 * 2), 0n);
  }, [client, nameLen, symbolLen]);
}

function BundleColumn({ title, raised, p }: { title: string; raised: bigint; p: BundlePreview }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-black/25 p-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-dim">{title}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{fmtLamports(raised)} SOL raised</div>
      <div className="mt-3 grid gap-2">
        <Row label="Bundle buys">
          <span className="text-lime">{p.supplyPct.toFixed(2)}%</span>
        </Row>
        <Row label="Tokens">{fmtTokens(p.bundleTokens)}</Row>
        <Row label="Into curve">{fmtLamports(p.bundleSol)}</Row>
        <Row label="Vault SOL">{fmtLamports(p.vaultSol)}</Row>
        <Row label="Launch fee">{fmtLamports(p.launchFee)}</Row>
        <Row label="Start price">{fmtPrice(p.priceAfter)}</Row>
        <Row label="Start mcap">{fmtSolValue(p.marketCapAfter)} SOL</Row>
      </div>
    </div>
  );
}

export function CreateForm() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMoshClient();
  const platform = usePlatform();
  const balance = useSolBalance(publicKey);
  const tx = useTx();

  const [draft, setDraft] = useState<CreateDraft>(INITIAL);
  const [touched, setTouched] = useState<Partial<Record<DraftField, boolean>>>({});
  const [showAll, setShowAll] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [stage, setStage] = useState<"upload" | "sign" | null>(null);

  useEffect(() => {
    if (!draft.image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(draft.image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.image]);

  const set = <K extends keyof CreateDraft>(key: K, value: CreateDraft[K], field?: DraftField) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (field) setTouched((t) => ({ ...t, [field]: true }));
  };

  const params = platform.data?.params;
  const minRaiseLamports = params ? BigInt(params.minRaiseLamports) : 1_000_000_000n;
  const maxBundlePct = (params?.maxBundleSupplyBps ?? 2_500) / 100;
  const v = useMemo(
    () => validateDraft(draft, { minRaiseLamports, maxBundleSupplyBps: params?.maxBundleSupplyBps ?? 2_500 }),
    [draft, minRaiseLamports, params?.maxBundleSupplyBps],
  );
  const err = (f: DraftField) => (showAll || touched[f] ? (v.errors[f] ?? null) : null);

  // previewBundle is a handful of bigint ops — cheap enough to run on every keystroke.
  const bundleInputs = useMemo(
    () => ({ min: draft.raiseMin, max: draft.raiseMax, bundle: draft.bundlePct, reserve: draft.reservePct }),
    [draft.raiseMin, draft.raiseMax, draft.bundlePct, draft.reservePct],
  );
  const previews = useMemo(() => {
    if (!params) return null;
    const toLamports = (s: string) => {
      const n = Number(s);
      return isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e9)) : null;
    };
    const lo = toLamports(bundleInputs.min);
    const hi = toLamports(bundleInputs.max);
    if (lo === null || hi === null || hi < lo) return null;
    const run = (raised: bigint) =>
      previewBundle({
        raised,
        virtualSol: BigInt(params.virtualSolReserves),
        launchFeeBps: params.launchFeeBps,
        reserveBps: Math.round(bundleInputs.reserve * 100),
        bundleSupplyBps: Math.round(bundleInputs.bundle * 100),
      });
    return { lo, hi, atMin: run(lo), atMax: run(hi) };
  }, [params, bundleInputs]);

  const whitelistRoot = useMemo(() => {
    if (!draft.whitelistOn || v.whitelist.length === 0 || v.badWhitelistLines.length) return null;
    return buildWhitelist(v.whitelist);
  }, [draft.whitelistOn, v.whitelist, v.badWhitelistLines.length]);

  const nameLen = new TextEncoder().encode(draft.name.trim()).length;
  const symbolLen = new TextEncoder().encode(draft.symbol.trim()).length;
  const rent = useCreateRent(Math.max(nameLen, 1), Math.max(symbolLen, 1));
  const createFee = params ? BigInt(params.createFeeLamports) : null;
  const totalCost = createFee !== null ? rent + createFee + TX_FEE_LAMPORTS : null;
  const insufficient = balance.data !== undefined && totalCost !== null && balance.data < totalCost;
  const selfExcluded =
    !!publicKey && draft.whitelistOn && v.whitelist.length > 0 && !v.whitelist.some((k) => k.equals(publicKey));
  const durationSecs = durationSecsOf(draft);
  const errorCount = Object.keys(v.errors).length;

  const submit = async () => {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    if (!v.parsed) {
      setShowAll(true);
      const first = document.querySelector<HTMLElement>("[aria-invalid='true']");
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.focus({ preventScroll: true });
      return;
    }
    const d = v.parsed;
    setStage("upload");
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
      setStage(null);
      return;
    }
    if (new TextEncoder().encode(uri).length > LIMITS.maxUriLen) {
      toast.error("Metadata upload failed", { description: `Metadata URI exceeds ${LIMITS.maxUriLen} bytes` });
      setStage(null);
      return;
    }

    setStage("sign");
    const mint = Keypair.generate();
    const signature = await tx.run({
      label: `Create $${d.symbol}`,
      successMessage: `$${d.symbol} raise is open`,
      signers: [mint],
      computeUnits: 400_000,
      build: async (payer) => {
        const onChain = await client.fetchPlatform();
        if (!onChain) throw new Error("Platform is not initialized on this cluster");
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
          }),
        ];
      },
    });
    setStage(null);
    if (signature) router.push(`/launch/${mint.publicKey.toBase58()}`);
  };

  const submitLabel = !publicKey
    ? "Connect wallet to create"
    : params?.paused
      ? "Platform is paused"
      : insufficient
        ? `Need ≈ ${fmtLamports(totalCost!)} SOL — get test SOL`
        : stage === "upload"
          ? "Uploading metadata…"
          : stage === "sign"
            ? "Creating launch…"
            : "Create launch";

  const bundleFill = ((draft.bundlePct - 1) / Math.max(1, maxBundlePct - 1)) * 100;
  const reserveFill = (draft.reservePct / (LIMITS.maxReserveBps / 100)) * 100;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="grid min-w-0 grid-cols-1 gap-5">
        <Section step={1} title="Token" description="Name, ticker and artwork are written into the Token-2022 mint metadata.">
          <div className="flex flex-col gap-5 sm:flex-row">
            <div>
              <ImageDrop
                preview={preview}
                invalid={!!err("image")}
                onFile={(f) => set("image", f, "image")}
                onClear={() => set("image", null, "image")}
              />
              {err("image") ? <p className="mt-2 text-xs font-medium text-down">{err("image")}</p> : null}
            </div>
            <div className="grid flex-1 gap-4">
              <Field label="Name" htmlFor="name" error={err("name")} counter={`${nameLen}/${LIMITS.maxNameLen}`}>
                <input
                  id="name"
                  className="field"
                  placeholder="Moshpit Money"
                  value={draft.name}
                  maxLength={64}
                  aria-invalid={!!err("name") || undefined}
                  onChange={(e) => set("name", e.target.value, "name")}
                />
              </Field>
              <Field label="Symbol" htmlFor="symbol" error={err("symbol")} counter={`${symbolLen}/${LIMITS.maxSymbolLen}`}>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-dim">$</span>
                  <input
                    id="symbol"
                    className="field pl-7 font-semibold uppercase"
                    placeholder="MOSH"
                    value={draft.symbol}
                    maxLength={LIMITS.maxSymbolLen}
                    aria-invalid={!!err("symbol") || undefined}
                    onChange={(e) => set("symbol", e.target.value.toUpperCase().replace(/\s/g, ""), "symbol")}
                  />
                </div>
              </Field>
            </div>
          </div>
          <Field
            label="Description"
            htmlFor="description"
            optional
            className="mt-4"
            error={err("description")}
            counter={`${draft.description.length}/${MAX_DESCRIPTION}`}
          >
            <textarea
              id="description"
              rows={3}
              className="field resize-y"
              placeholder="What is this token about?"
              value={draft.description}
              aria-invalid={!!err("description") || undefined}
              onChange={(e) => set("description", e.target.value, "description")}
            />
          </Field>
        </Section>

        <Section step={2} title="Links" description="Shown on the launch page. Handles or full links both work.">
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                { key: "twitter", label: "X / Twitter", icon: AtSign, ph: "@handle" },
                { key: "telegram", label: "Telegram", icon: Send, ph: "t.me/group" },
                { key: "website", label: "Website", icon: Globe, ph: "example.com" },
              ] as const
            ).map(({ key, label, icon: Icon, ph }) => (
              <Field key={key} label={label} htmlFor={key} optional error={err(key)}>
                <div className="relative">
                  <Icon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-dim" aria-hidden />
                  <input
                    id={key}
                    className="field pl-10"
                    placeholder={ph}
                    value={draft[key]}
                    aria-invalid={!!err(key) || undefined}
                    onChange={(e) => set(key, e.target.value, key)}
                  />
                </div>
              </Field>
            ))}
          </div>
        </Section>

        <Section
          step={3}
          title="Raise"
          description="Backers deposit SOL. If the minimum isn't met by the deadline, everyone gets a full refund."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Minimum"
              htmlFor="raiseMin"
              error={err("raiseMin")}
              hint={`Platform min ${lamportsToSol(minRaiseLamports)} SOL`}
            >
              <AmountInput
                id="raiseMin"
                unit="SOL"
                value={draft.raiseMin}
                invalid={!!err("raiseMin")}
                onChange={(x) => set("raiseMin", x, "raiseMin")}
              />
            </Field>
            <Field label="Maximum" htmlFor="raiseMax" error={err("raiseMax")} hint="Deposits are clipped at the cap">
              <AmountInput
                id="raiseMax"
                unit="SOL"
                value={draft.raiseMax}
                invalid={!!err("raiseMax")}
                onChange={(x) => set("raiseMax", x, "raiseMax")}
              />
            </Field>
            <Field label="Per-wallet cap" htmlFor="perWallet" optional error={err("perWallet")} hint="Empty = no cap">
              <AmountInput
                id="perWallet"
                unit="SOL"
                placeholder="No cap"
                value={draft.perWallet}
                invalid={!!err("perWallet")}
                onChange={(x) => set("perWallet", x, "perWallet")}
              />
            </Field>
          </div>
          <Field label="Raise duration" className="mt-5" error={err("duration")}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="no-scrollbar max-w-full overflow-x-auto">
                <Segmented
                  ariaLabel="Raise duration"
                  value={draft.duration}
                  onChange={(x) => set("duration", x, "duration")}
                  options={[...DURATION_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Custom" }]}
                />
              </div>
              {draft.duration === "custom" ? (
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Custom duration"
                    inputMode="decimal"
                    className="field h-10 w-24 py-0 tabular-nums"
                    value={draft.customValue}
                    aria-invalid={!!err("duration") || undefined}
                    onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && set("customValue", e.target.value, "duration")}
                  />
                  <select
                    aria-label="Duration unit"
                    className="field h-10 w-28 cursor-pointer py-0"
                    value={draft.customUnit}
                    onChange={(e) => set("customUnit", e.target.value as CreateDraft["customUnit"], "duration")}
                  >
                    <option value="m" className="bg-panel">minutes</option>
                    <option value="h" className="bg-panel">hours</option>
                    <option value="d" className="bg-panel">days</option>
                  </select>
                </div>
              ) : null}
              {durationSecs && !v.errors.duration ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-dim">
                  <Clock className="size-3.5" aria-hidden /> closes {fmtDuration(durationSecs)} after creation
                </span>
              ) : null}
            </div>
          </Field>
        </Section>

        <Section
          step={4}
          title="Bundle & vault"
          description="At launch the raise buys the first slice of the curve before anyone else can trade. That bundle is locked forever."
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  Max bundle size <Hint>Upper bound on the share of supply the bundle buys. Excess SOL stays in the vault.</Hint>
                </span>
              }
              htmlFor="bundlePct"
              error={err("bundlePct")}
              counter={<span className="text-sm font-semibold text-lime">{draft.bundlePct}% of supply</span>}
            >
              <input
                id="bundlePct"
                type="range"
                className="range mt-2"
                min={1}
                max={maxBundlePct}
                step={0.5}
                value={draft.bundlePct}
                style={{ ["--fill" as string]: `${bundleFill}%` }}
                onChange={(e) => set("bundlePct", Number(e.target.value), "bundlePct")}
              />
              <div className="mt-1.5 flex justify-between text-[11px] text-dim tabular-nums">
                <span>1%</span>
                <span>{maxBundlePct}% platform max</span>
              </div>
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  Vault SOL reserve <Hint>Share of the raise kept as SOL in the vault so agents can buy dips.</Hint>
                </span>
              }
              htmlFor="reservePct"
              error={err("reservePct")}
              counter={<span className="text-sm font-semibold text-lime">{draft.reservePct}% of raise</span>}
            >
              <input
                id="reservePct"
                type="range"
                className="range mt-2"
                min={0}
                max={LIMITS.maxReserveBps / 100}
                step={1}
                value={draft.reservePct}
                style={{ ["--fill" as string]: `${reserveFill}%` }}
                onChange={(e) => set("reservePct", Number(e.target.value), "reservePct")}
              />
              <div className="mt-1.5 flex justify-between text-[11px] text-dim tabular-nums">
                <span>0%</span>
                <span>{LIMITS.maxReserveBps / 100}%</span>
              </div>
            </Field>
          </div>
        </Section>

        <Section step={5} title="Access" description="Open to everyone, or restricted to a list of wallets (verified on-chain with a merkle proof).">
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line bg-black/25 px-4 py-3">
            <span className="flex items-center gap-3">
              <Lock className={cn("size-4", draft.whitelistOn ? "text-warn" : "text-dim")} aria-hidden />
              <span>
                <span className="block text-sm font-medium">Whitelist raise</span>
                <span className="block text-xs text-dim">Only listed wallets can deposit</span>
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="peer sr-only"
              checked={draft.whitelistOn}
              onChange={(e) => set("whitelistOn", e.target.checked, "whitelist")}
            />
            <span
              aria-hidden
              className="relative h-6 w-11 shrink-0 rounded-full bg-white/10 transition peer-checked:bg-lime peer-focus-visible:ring-2 peer-focus-visible:ring-lime/60 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5"
            />
          </label>
          {draft.whitelistOn ? (
            <Field
              label="Wallets (one per line)"
              htmlFor="whitelist"
              className="mt-4"
              error={err("whitelist")}
              counter={`${v.whitelist.length} valid`}
              hint={
                whitelistRoot ? (
                  <span className="font-mono">
                    root {Buffer.from(whitelistRoot.root).toString("hex").slice(0, 16)}… · {whitelistRoot.members.length} unique
                  </span>
                ) : undefined
              }
            >
              <textarea
                id="whitelist"
                rows={5}
                spellCheck={false}
                className="field resize-y font-mono text-[12.5px] leading-relaxed"
                placeholder={"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU\n9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"}
                value={draft.whitelistText}
                aria-invalid={!!err("whitelist") || undefined}
                onChange={(e) => set("whitelistText", e.target.value, "whitelist")}
              />
              {selfExcluded ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warn">
                  Your wallet isn&apos;t on the list, so you can&apos;t back your own raise.
                  <button
                    type="button"
                    className="font-semibold text-lime hover:underline"
                    onClick={() =>
                      set("whitelistText", `${publicKey!.toBase58()}\n${draft.whitelistText}`.trim(), "whitelist")
                    }
                  >
                    Add my wallet
                  </button>
                </div>
              ) : null}
            </Field>
          ) : null}
        </Section>
      </div>

      <aside className="grid gap-5 lg:sticky lg:top-24">
        <Card className="overflow-hidden">
          <CardHeader title="Live preview" right={<PhasePill phase="raising" />} />
          <div className="px-5 pb-5">
            <div className="flex items-center gap-3">
              <TokenAvatar src={preview} symbol={draft.symbol || "?"} size={56} />
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold">{draft.name.trim() || "Your token"}</div>
                <div className="flex items-center gap-1.5 text-sm text-muted">
                  ${draft.symbol || "TICKER"}
                  {draft.whitelistOn ? <Lock className="size-3 text-warn" aria-label="Whitelist" /> : null}
                </div>
              </div>
            </div>
            {draft.description.trim() ? (
              <p className="mt-3 line-clamp-2 text-sm text-muted">{draft.description}</p>
            ) : null}
            <div className="mt-4 flex items-baseline justify-between text-sm">
              <span className="font-semibold tabular-nums">
                0 <span className="text-dim">/ {draft.raiseMax || "—"} SOL</span>
              </span>
              <span className="text-xs text-dim tabular-nums">min {draft.raiseMin || "—"}</span>
            </div>
            <RaiseBar
              raised="0"
              raiseMin={previews ? previews.lo.toString() : "0"}
              raiseMax={previews ? previews.hi.toString() : "1"}
              className="mt-2"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>
                <Clock className="size-3" aria-hidden /> {durationSecs ? fmtDuration(durationSecs) : "—"}
              </Badge>
              <Badge>Bundle ≤ {draft.bundlePct}%</Badge>
              <Badge>Reserve {draft.reservePct}%</Badge>
              {draft.perWallet ? (
                <Badge>
                  <Users className="size-3" aria-hidden /> ≤ {draft.perWallet} SOL/wallet
                </Badge>
              ) : null}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Bundle preview"
            icon={<ShieldCheck className="size-3.5 text-lime" aria-hidden />}
            right={<span className="text-[11px] text-dim">exact program math</span>}
          />
          <div className="px-5 pb-5">
            {previews ? (
              <>
                <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
                  <BundleColumn title="At minimum" raised={previews.lo} p={previews.atMin} />
                  <BundleColumn title="At maximum" raised={previews.hi} p={previews.atMax} />
                </div>
                {previews.atMax.bundleTokens * 10_000n >= TOTAL_SUPPLY * BigInt(Math.round(draft.bundlePct * 100)) ? (
                  <p className="mt-3 text-xs leading-relaxed text-dim">
                    At the max raise the bundle hits its {draft.bundlePct}% cap — the extra SOL stays in the vault for
                    agents.
                  </p>
                ) : null}
              </>
            ) : platform.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <p className="text-sm text-dim">Enter a valid min and max raise to preview the bundle.</p>
            )}
          </div>
        </Card>

        <Card>
          <div className="grid gap-2 p-5">
            <Row label="Create fee">{createFee !== null ? `${fmtLamports(createFee)} SOL` : "—"}</Row>
            <Row
              label={
                <span className="inline-flex items-center gap-1.5">
                  Account rent <Hint>Launch account, mint with on-chain metadata, curve and vault token accounts.</Hint>
                </span>
              }
            >
              {`≈ ${fmtLamports(rent)} SOL`}
            </Row>
            <Row label="Network fee">≈ {fmtLamports(TX_FEE_LAMPORTS)} SOL</Row>
            <div className="my-1 h-px bg-line" />
            <Row label={<span className="font-medium text-ink">Total</span>}>
              <span className="text-[15px] font-semibold">{totalCost !== null ? `≈ ${fmtLamports(totalCost)} SOL` : "—"}</span>
            </Row>
            <Button
              variant="primary"
              size="lg"
              className="mt-3 w-full"
              icon={<Rocket className="size-4" aria-hidden />}
              loading={stage !== null}
              disabled={!!publicKey && (!!params?.paused || insufficient)}
              onClick={() => void submit()}
            >
              {submitLabel}
            </Button>
            {showAll && errorCount > 0 ? (
              <p className="text-center text-xs font-medium text-down">
                {errorCount} field{errorCount === 1 ? "" : "s"} need{errorCount === 1 ? "s" : ""} attention
              </p>
            ) : (
              <p className="text-center text-xs text-dim">
                You sign one transaction. Mint authority is revoked in the same instruction.
              </p>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}
