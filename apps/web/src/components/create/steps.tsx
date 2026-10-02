"use client";

import { LIMITS, PUMP_VENUE_FEE_BPS } from "@holdfast/sdk";
import type { PublicKey } from "@solana/web3.js";
import { ChevronDown, Upload } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { fmtLamports, fmtSolValue, fmtUsd } from "@/lib/format";
import { fmtInterval, fmtMult, pumpSplit } from "@/lib/pump-terms";
import { useStats } from "@/lib/queries";
import type { PlatformInfo } from "@/lib/types";
import { ClampGlyph } from "../brand/glyphs";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Field, Input, Textarea } from "../ui/input";
import { Select } from "../ui/select";
import { Segmented } from "../ui/tabs";
import { TokenAvatar } from "../ui/token-avatar";
import { RuleTooltip } from "../ui/tooltip";
import { ImageDrop } from "./image-drop";
import type { BundleRange } from "./math";
import { SupplyBar } from "./preview";
import { Slider } from "./slider";
import {
  bundleBpsOf,
  DURATION_PRESETS,
  durationSecsOf,
  extractAddresses,
  fmtDuration,
  MAX_DESCRIPTION,
  STEPS,
  utf8Len,
  type CreateDraft,
  type DraftField,
  type DurationUnit,
  type StepIndex,
  type Validation,
} from "./validate";

export interface StepContext {
  draft: CreateDraft;
  set: <K extends keyof CreateDraft>(key: K, value: CreateDraft[K], field?: DraftField) => void;
  /** Error for a field once it's been touched or its step was submitted. */
  err: (f: DraftField) => string | null;
  v: Validation;
  params: PlatformInfo["params"] | undefined;
  /** The platform's max bundle share in bps (the hard limit until /api/platform loads): what "No cap" submits. */
  maxBundleBps: number;
}

const pctText = (v: number) => `${v.toFixed(v >= 10 ? 1 : 2)}%`;

/** Keep digits and one decimal point, up to 9 places (lamports). */
function sanitizeSol(raw: string): string | null {
  const v = raw.replace(",", ".");
  return /^\d*\.?\d{0,9}$/.test(v) ? v : null;
}

export function StepHeader({ index, help }: { index: StepIndex; help: ReactNode }) {
  return (
    <header className="grid gap-1">
      <p className="label text-ink-3">
        Step {index + 1} of {STEPS.length}
      </p>
      <h2 className="h2 text-ink">{STEPS[index].label}</h2>
      <p className="body text-ink-2">{help}</p>
    </header>
  );
}

/* ---------------------------------------------------------------- 1 · Token */

export function StepToken({
  ctx,
  imageUrl,
  imageBusy,
  imageError,
  onImage,
}: {
  ctx: StepContext;
  imageUrl: string | null;
  imageBusy: boolean;
  imageError: string | null;
  onImage: (file: File | null) => void;
}) {
  const { draft, set, err } = ctx;
  const hasLinks = !!(draft.twitter || draft.telegram || err("twitter") || err("telegram"));
  const [linksOpen, setLinksOpen] = useState(hasLinks);
  const linksId = useId();
  const showLinks = linksOpen || hasLinks;

  return (
    <div className="grid gap-6">
      <StepHeader index={0} help="What backers see on Discover and on your launch page." />
      <Field label="Image" error={imageError ?? err("image")}>
        {(id) => (
          <ImageDrop
            id={id}
            image={draft.image}
            preview={imageUrl}
            busy={imageBusy}
            invalid={!!(imageError ?? err("image"))}
            onFile={(f) => onImage(f)}
            onClear={() => onImage(null)}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
        <Field label="Name" aside={`${utf8Len(draft.name.trim())}/${LIMITS.maxNameLen}`} error={err("name")}>
          {(id) => (
            <Input
              id={id}
              placeholder="Moshpit Money"
              autoComplete="off"
              maxLength={64}
              value={draft.name}
              invalid={!!err("name")}
              onChange={(e) => set("name", e.target.value, "name")}
            />
          )}
        </Field>
        <Field label="Ticker" aside={`${draft.symbol.length}/${LIMITS.maxSymbolLen}`} error={err("symbol")}>
          {(id) => (
            <Input
              id={id}
              prefix="$"
              placeholder="MOSH"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={LIMITS.maxSymbolLen}
              value={draft.symbol}
              invalid={!!err("symbol")}
              onChange={(e) => set("symbol", e.target.value.toUpperCase().replace(/\s/g, ""), "symbol")}
            />
          )}
        </Field>
      </div>
      <Field
        label="Description"
        aside={`optional · ${draft.description.length}/${MAX_DESCRIPTION}`}
        error={err("description")}
      >
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            placeholder="What is this token about?"
            value={draft.description}
            invalid={!!err("description")}
            onChange={(e) => set("description", e.target.value, "description")}
          />
        )}
      </Field>
      <div className="grid gap-4">
        <button
          type="button"
          aria-expanded={showLinks}
          aria-controls={linksId}
          onClick={() => setLinksOpen(!showLinks)}
          className="ui inline-flex h-10 items-center gap-1.5 justify-self-start text-ink-2 transition-colors hover:text-ink"
        >
          <ChevronDown
            className={cn("size-4 transition-transform duration-(--dur-2)", showLinks ? "rotate-0" : "-rotate-90")}
            strokeWidth={1.5}
            aria-hidden
          />
          Add links <span className="text-ink-3">(optional)</span>
        </button>
        {showLinks ? (
          <div id={linksId} className="grid gap-4 sm:grid-cols-2">
            {(
              [
                { key: "twitter", label: "X", ph: "@handle" },
                { key: "telegram", label: "Telegram", ph: "t.me/group" },
              ] as const
            ).map(({ key, label, ph }) => (
              <Field key={key} label={label} error={err(key)}>
                {(id) => (
                  <Input
                    id={id}
                    placeholder={ph}
                    autoComplete="off"
                    spellCheck={false}
                    value={draft[key]}
                    invalid={!!err(key)}
                    onChange={(e) => set(key, e.target.value, key)}
                  />
                )}
              </Field>
            ))}
          </div>
        ) : null}
      </div>
      <p className="small flex items-start gap-2 text-ink-3">
        <ClampGlyph className="mt-px shrink-0" />
        Name, ticker and image are written on-chain and can&apos;t be changed.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- 2 · Raise */

const UNIT_OPTIONS: { value: DurationUnit; label: string }[] = [
  { value: "m", label: "minutes" },
  { value: "h", label: "hours" },
  { value: "d", label: "days" },
];

export function StepRaise({ ctx }: { ctx: StepContext }) {
  const { draft, set, err, params } = ctx;
  const minRaise = params ? fmtLamports(params.minRaiseLamports) : null;
  // Mainnet-beta caps ("0" or absent = none).
  const raiseCap = params?.maxRaiseLamports && params.maxRaiseLamports !== "0" ? fmtLamports(params.maxRaiseLamports) : null;
  const walletCap =
    params?.maxWalletDepositLamports && params.maxWalletDepositLamports !== "0" ? fmtLamports(params.maxWalletDepositLamports) : null;
  const durationSecs = durationSecsOf(draft);
  const sol = (key: "raiseMin" | "raiseMax" | "perWallet") => (e: { target: { value: string } }) => {
    const v = sanitizeSol(e.target.value);
    if (v !== null) set(key, v, key);
  };

  return (
    <div className="grid gap-6">
      <StepHeader
        index={1}
        help="Backers deposit SOL until the deadline. If the minimum isn't met by then, everyone gets a full refund."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Minimum"
          error={err("raiseMin")}
          hint={minRaise ? `Platform minimum ${minRaise} SOL` : undefined}
        >
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              autoComplete="off"
              suffix="SOL"
              className="num"
              value={draft.raiseMin}
              invalid={!!err("raiseMin")}
              onChange={sol("raiseMin")}
            />
          )}
        </Field>
        <Field
          label="Maximum"
          error={err("raiseMax")}
          hint={raiseCap ? `Beta cap: ${raiseCap} SOL` : "Deposits stop at the cap"}
        >
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              autoComplete="off"
              suffix="SOL"
              className="num"
              value={draft.raiseMax}
              invalid={!!err("raiseMax")}
              onChange={sol("raiseMax")}
            />
          )}
        </Field>
      </div>
      <Field
        label="Per-wallet cap"
        aside="optional"
        error={err("perWallet")}
        hint={walletCap ? `Beta cap: ${walletCap} SOL per wallet` : "Leave empty for no cap"}
      >
        {(id) => (
          <Input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            suffix="SOL"
            placeholder="No cap"
            className="num sm:max-w-[calc(50%-8px)]"
            value={draft.perWallet}
            invalid={!!err("perWallet")}
            onChange={sol("perWallet")}
          />
        )}
      </Field>
      <div className="grid gap-1.5">
        <span className="label text-ink-3">Duration</span>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Raise duration"
            value={draft.duration}
            onChange={(x) => set("duration", x, "duration")}
            items={[...DURATION_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: "custom" as const, label: "Custom" }]}
          />
          {draft.duration === "custom" ? (
            <div className="flex items-center gap-2">
              <Input
                aria-label="Custom duration"
                inputMode="decimal"
                autoComplete="off"
                className="num w-24"
                value={draft.customValue}
                invalid={!!err("duration")}
                onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && set("customValue", e.target.value, "duration")}
              />
              <Select
                label="Duration unit"
                value={draft.customUnit}
                onChange={(u) => set("customUnit", u, "duration")}
                options={UNIT_OPTIONS}
              />
            </div>
          ) : null}
        </div>
        {err("duration") ? (
          <p role="alert" className="small text-down">
            {err("duration")}
          </p>
        ) : durationSecs ? (
          <p className="small text-ink-3">Closes {fmtDuration(durationSecs)} after creation.</p>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- 3 · Vault & access */

export function StepVault({
  ctx,
  range,
  wallet,
}: {
  ctx: StepContext;
  range: BundleRange | null;
  wallet: PublicKey | null;
}) {
  const { draft, set, err, v, params, maxBundleBps } = ctx;
  const solUsd = useStats().data?.solUsd ?? null;
  const maxBundlePct = maxBundleBps / 100;
  const capPct = bundleBpsOf(draft, maxBundleBps) / 100;
  const maxReservePct = LIMITS.maxReserveBps / 100;
  const mcap = (sol: number) => (solUsd ? `${fmtUsd(sol * solUsd)} (${fmtSolValue(sol)} SOL)` : `${fmtSolValue(sol)} SOL`);
  const csv = useRef<HTMLInputElement>(null);
  const selfExcluded = !!wallet && draft.access === "whitelist" && v.whitelist.length > 0 && !v.whitelist.some((k) => k.equals(wallet));

  const addAddresses = (text: string) => {
    const found = extractAddresses(text);
    if (!found.length) return;
    set("whitelistText", [draft.whitelistText.trim(), ...found].filter(Boolean).join("\n"), "whitelist");
  };

  return (
    <div className="grid gap-6">
      <StepHeader
        index={2}
        help="When the raise closes, it buys the first slice of the curve. That bundle is held in the vault and traded only by the vault agent."
      />
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="label text-ink-3">Bundle size</span>
          <Segmented<CreateDraft["bundleCap"]>
            label="Bundle cap"
            value={draft.bundleCap}
            onChange={(x) => set("bundleCap", x, "bundlePct")}
            items={[
              { value: "none", label: "No cap" },
              { value: "custom", label: "Custom cap" },
            ]}
          />
        </div>
        <p className="small text-ink-2">
          {draft.bundleCap === "none"
            ? `No cap: the raise buys as much as it can, up to the platform max of ${maxBundlePct}% of supply.`
            : "The most supply the bundle may buy; SOL beyond it stays in the vault."}{" "}
          {params?.holdfastCurveEnabled ? null : "The bundle never completes the pump.fun curve at launch."}
        </p>
      </div>
      {draft.bundleCap === "custom" ? (
        <Field label="Custom cap" aside={<span className="text-ink">{capPct}% of supply</span>} error={err("bundlePct")}>
          {(id) => (
            <div>
              <Slider
                id={id}
                min={LIMITS.minBundleSupplyBps / 100}
                max={maxBundlePct}
                step={0.5}
                value={capPct}
                valueText={`${capPct}% of supply`}
                invalid={!!err("bundlePct")}
                onChange={(x) => set("bundlePct", x, "bundlePct")}
              />
              <div className="micro num flex justify-between text-ink-3">
                <span>{LIMITS.minBundleSupplyBps / 100}%</span>
                <span>{maxBundlePct}% platform max</span>
              </div>
            </div>
          )}
        </Field>
      ) : null}
      <Field
        label="Vault SOL reserve"
        aside={<span className="text-ink">{draft.reservePct}% of raise</span>}
        error={err("reservePct")}
        hint={
          <>
            Kept as SOL so the vault agent can buy dips.
            {range ? (
              <span className="num text-ink-2">
                {" "}
                {fmtLamports(range.atMin.vaultSol)}–{fmtLamports(range.atMax.vaultSol)} SOL in the vault at min–max.
              </span>
            ) : null}
          </>
        }
      >
        {(id) => (
          <div>
            <Slider
              id={id}
              min={0}
              max={maxReservePct}
              step={1}
              value={draft.reservePct}
              valueText={`${draft.reservePct}% of the raise`}
              invalid={!!err("reservePct")}
              onChange={(x) => set("reservePct", x, "reservePct")}
            />
            <div className="micro num flex justify-between text-ink-3">
              <span>0%</span>
              <span>{maxReservePct}%</span>
            </div>
          </div>
        )}
      </Field>

      {range && params ? (
        <div className="grid gap-4 rounded-md border border-accent bg-accent-wash p-4">
          <p className="body text-ink">
            At <span className="num">{fmtLamports(range.lo)}</span> SOL the bundle buys{" "}
            <strong className="num font-semibold">≈{pctText(range.atMin.supplyPct)}</strong> of supply; at{" "}
            <span className="num">{fmtLamports(range.hi)}</span> SOL{" "}
            <strong className="num font-semibold">≈{pctText(range.atMax.supplyPct)}</strong>, held in the vault. Start market cap ≈{" "}
            <strong className="num font-semibold">{mcap(range.atMin.marketCapAfter)}</strong> at the minimum and ≈{" "}
            <strong className="num font-semibold">{mcap(range.atMax.marketCapAfter)}</strong> at the maximum.{" "}
            {params.holdfastCurveEnabled ? (
              <>
                Backers earn <strong className="num font-semibold">{params.backerFeeShareBps / 100}%</strong> of every trade fee. When the
                vault is {fmtMult(pumpSplit(params).payoutMult)} its start and the chart is strong, the vault agent may pay them back.
              </>
            ) : (
              <>
                The token is created on pump.fun at launch; backers earn{" "}
                <strong className="num font-semibold">{pumpSplit(params).backerPct}%</strong> of its pump.fun creator fees. When the vault
                is {fmtMult(pumpSplit(params).payoutMult)} its start and the chart is strong, the vault agent may pay them back.
              </>
            )}
          </p>
          <div className="grid gap-3">
            <SupplyBar label={`At min · ${fmtLamports(range.lo)} SOL`} supplyPct={range.atMin.supplyPct} />
            <SupplyBar label={`At max · ${fmtLamports(range.hi)} SOL`} supplyPct={range.atMax.supplyPct} />
          </div>
        </div>
      ) : (
        <p className="small text-ink-3">Set a valid minimum and maximum raise to preview the bundle.</p>
      )}

      <div className="grid gap-3 border-t border-line pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="grid gap-0.5">
            <span className="label text-ink-3">Access</span>
            <span className="small text-ink-2">
              {draft.access === "whitelist"
                ? "Only listed wallets can deposit (checked on-chain with a merkle proof)."
                : draft.access === "self"
                  ? "Only you can deposit: you fund the whole bundle yourself, and all backer earnings are yours."
                  : "Anyone can back the raise."}
            </span>
          </span>
          <Segmented<CreateDraft["access"]>
            label="Who can back the raise"
            value={draft.access}
            onChange={(x) => set("access", x, "whitelist")}
            items={[
              { value: "open", label: "Open" },
              { value: "whitelist", label: "Whitelist" },
              { value: "self", label: "Fund it yourself" },
            ]}
          />
        </div>
        {draft.access === "self" ? (
          <p className={cn("small", err("whitelist") ? "text-warn" : "text-ink-2")}>
            {err("whitelist") ??
              `Deposits are limited to ${wallet ? `${wallet.toBase58().slice(0, 4)}…${wallet.toBase58().slice(-4)}` : "your wallet"}; the per-wallet beta cap doesn't apply to a creator funding their own raise.`}
          </p>
        ) : null}
        {draft.access === "whitelist" ? (
          <Field
            label="Wallets"
            aside={
              <>
                {v.whitelist.length.toLocaleString("en-US")} unique
                {v.whitelistDuplicates ? ` · ${v.whitelistDuplicates} duplicate${v.whitelistDuplicates === 1 ? "" : "s"} ignored` : ""}
              </>
            }
            error={err("whitelist")}
            hint="One address per line, or upload a CSV: every wallet address in it is added."
          >
            {(id) => (
              <div className="grid gap-2">
                <Textarea
                  id={id}
                  rows={6}
                  spellCheck={false}
                  className="font-mono text-[12.5px] leading-5"
                  placeholder={"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU\n9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"}
                  value={draft.whitelistText}
                  invalid={!!err("whitelist")}
                  onChange={(e) => set("whitelistText", e.target.value, "whitelist")}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" icon={<Upload className="size-4" strokeWidth={1.5} aria-hidden />} onClick={() => csv.current?.click()}>
                    Upload CSV
                  </Button>
                  {selfExcluded && wallet ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => set("whitelistText", `${wallet.toBase58()}\n${draft.whitelistText}`.trim(), "whitelist")}
                    >
                      Add my wallet
                    </Button>
                  ) : null}
                </div>
                {selfExcluded ? (
                  <p className="small text-warn">Your wallet isn&apos;t on the list, so you couldn&apos;t back your own raise.</p>
                ) : null}
                <input
                  ref={csv}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) addAddresses(await file.text());
                  }}
                />
              </div>
            )}
          </Field>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 4 · Review */

function ReviewGroup({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="label text-ink-3">{title}</h3>
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}>
          Edit
        </Button>
      </div>
      <dl className="small grid gap-2">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="num min-w-0 text-right break-words text-ink">{children}</dd>
    </div>
  );
}

export function StepReview({
  ctx,
  imageUrl,
  onEdit,
  cost,
  action,
}: {
  ctx: StepContext;
  imageUrl: string | null;
  onEdit: (step: StepIndex) => void;
  cost: ReactNode;
  action: ReactNode;
}) {
  const { draft, v, params, maxBundleBps } = ctx;
  const durationSecs = durationSecsOf(draft);
  const links = [draft.twitter, draft.telegram].filter((l) => l.trim());
  const errorFields = Object.keys(v.errors) as DraftField[];
  const platformShare = params ? 10_000 - params.backerFeeShareBps - params.creatorFeeShareBps : null;
  // What `create_launch_pump` freezes: the creator-fee split, the payback rule, the vault floor.
  const split = pumpSplit(params);
  const mins = (s: number) => (s % 3_600 === 0 ? `${s / 3_600} h` : s % 60 === 0 ? `${s / 60} min` : `${s} s`);

  return (
    <div className="grid gap-6">
      <StepHeader index={3} help="Check everything once more. Creating opens the raise immediately." />

      <div className="grid gap-4 rounded-md border border-line bg-surface p-4">
        <ReviewGroup title="Token" onEdit={() => onEdit(0)}>
          <div className="flex items-center gap-3 pb-1">
            <TokenAvatar src={imageUrl} symbol={draft.symbol || "?"} mint={draft.symbol || "draft"} size={40} />
            <span className="min-w-0">
              <span className="ui block truncate text-ink">{draft.name.trim() || "—"}</span>
              <span className="small block text-ink-2">${draft.symbol || "—"}</span>
            </span>
          </div>
          {draft.description.trim() ? <Row label="Description">{draft.description.trim()}</Row> : null}
          <Row label="Links">{links.length ? links.join(" · ") : "None"}</Row>
        </ReviewGroup>
        <ReviewGroup title="Raise" onEdit={() => onEdit(1)}>
          <Row label="Min – max">
            {draft.raiseMin || "—"} – {draft.raiseMax || "—"} SOL
          </Row>
          <Row label="Per-wallet cap">{draft.access === "self" ? "Creator only" : draft.perWallet ? `${draft.perWallet} SOL` : "No cap"}</Row>
          <Row label="Duration">{durationSecs ? fmtDuration(durationSecs) : "—"}</Row>
        </ReviewGroup>
        <ReviewGroup title="Vault & access" onEdit={() => onEdit(2)}>
          <Row label="Bundle cap">
            {draft.bundleCap === "none" ? `No cap · up to ${maxBundleBps / 100}% of supply` : `${bundleBpsOf(draft, maxBundleBps) / 100}% of supply`}
          </Row>
          <Row label="SOL reserve">{draft.reservePct}% of raise</Row>
          <Row label="Access">
            {draft.access === "whitelist" ? `Whitelist · ${v.whitelist.length.toLocaleString("en-US")} wallets` : draft.access === "self" ? "Self-funded (creator only)" : "Open"}
          </Row>
        </ReviewGroup>
      </div>

      {params ? (
        <section aria-labelledby="terms-heading" className="grid gap-3">
          <div className="grid gap-1">
            <h3 id="terms-heading" className="h3 text-ink">
              Frozen terms
            </h3>
            <p className="small text-ink-2">These are copied into your launch and can never change.</p>
          </div>
          <dl className="small grid gap-2 rounded-md border border-line p-4">
            {params.holdfastCurveEnabled ? (
              <>
                <Row label="Trade fee">{params.tradeFeeBps / 100}% of every public trade</Row>
                <Row label="Fee split">
                  {params.backerFeeShareBps / 100}% backers · {params.creatorFeeShareBps / 100}% you ·{" "}
                  {platformShare !== null ? platformShare / 100 : "—"}% platform
                </Row>
              </>
            ) : (
              <>
                <Row label="Venue">pump.fun token · trades happen on pump.fun ({PUMP_VENUE_FEE_BPS / 100}% venue fee), 0% trade fee on Holdfast</Row>
                <Row label="pump.fun creator fees">
                  {split.vaultPct}% vault · {split.burnPct}% buyback &amp; burn · {split.backerPct}% backers
                </Row>
                <Row label="Backer payback">
                  vault at {fmtMult(split.payoutMult)} its start and a strong chart · principal first, then {split.payoutSharePct}% of the
                  vault every {fmtInterval(split.payoutIntervalHours)}
                </Row>
                <Row label="Vault floor">{split.minVaultSol} SOL never paid out or spent</Row>
                <Row label="Creator share">0% — you earn through the vault like every backer</Row>
              </>
            )}
            <Row label="Launch fee">{params.launchFeeBps / 100}% of the raise</Row>
            <Row label={<RuleTooltip rule="The EMA is the slow reference price the agent's band is measured from.">Agent band</RuleTooltip>}>
              buys ≥ {params.agentBandBps / 100}% under EMA · sells ≥ {params.agentBandBps / 100}% over
            </Row>
            <Row label="Agent budget">
              {params.agentBuyBpsPerWindow / 100}% of vault SOL · {params.agentSellBpsPerWindow / 100}% of vault tokens per{" "}
              {mins(params.agentWindowSecs)}
            </Row>
            <Row label="Max impact">{params.agentMaxImpactBps / 100}% per agent trade</Row>
            <Row label="EMA period">{mins(params.emaPeriodSecs)}</Row>
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="cost-heading" className="grid gap-3">
        <h3 id="cost-heading" className="h3 text-ink">
          Cost
        </h3>
        <div className="rounded-md border border-line p-4">{cost}</div>
      </section>

      {errorFields.length ? (
        <div role="alert" className="small grid gap-2 border-l-2 border-warn bg-warn-wash/40 py-3 pr-3 pl-4 text-ink">
          <p>
            {errorFields.length} field{errorFields.length === 1 ? " needs" : "s need"} attention before you can create.
          </p>
          <ul className="flex flex-wrap gap-2">
            {STEPS.slice(0, 3).map((s, i) =>
              (s.fields as readonly DraftField[]).some((f) => v.errors[f]) ? (
                <li key={s.id}>
                  <Button size="sm" variant="secondary" onClick={() => onEdit(i as StepIndex)}>
                    Fix {s.label.toLowerCase()}
                  </Button>
                </li>
              ) : null,
            )}
          </ul>
        </div>
      ) : null}

      {action}
    </div>
  );
}
