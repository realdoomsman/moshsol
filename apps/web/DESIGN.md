# Holdfast web — design system usage

The source of truth for *what* to build is the design brief (`C:/tech/holdfast-research/design-brief.md`). This
file is *how* to build it here: tokens, classes and components that already exist. Use them; don't add a second
convention.

## Surfaces and route groups

| Group | Theme | Layout gives you |
|---|---|---|
| `app/(marketing)` — `/`, `/docs/**` | Paper | sticky `MarketingHeader`, `<main class="flex-1">`, `MarketingFooter` (links, program ID, status bar) |
| `app/(app)` — everything else | Night | `AppHeader` (nav, search, network pill, test SOL, wallet), `<main class="frame-app pt-6 …">`, desktop status bar, mobile bottom tabs |

- Theme = `data-theme` on the group's `ThemeRoot` (`components/shell/theme-root.tsx`); it also themes `<html>`, so
  portals (dialogs, toasts, popovers) inherit the right tokens. Never set `data-theme` anywhere else.
- App pages render inside `frame-app` already (max 1600, 24/16px padding). Don't add another page container.
- Marketing sections: wrap content in `frame-marketing` (max 1264, 32/20px padding). Sections are separated by 1px
  `line` rules, not cards.
- SSR prefetch + `<Hydrate>` stays the pattern for every data page (`lib/prefetch.tsx`).

## Tokens (Tailwind v4, `app/globals.css`)

Colours (both themes): `paper surface raised sunken field ink ink-2 ink-3 line line-2 accent accent-ink accent-wash
on-accent up up-wash on-up down down-wash on-down warn warn-wash scrim` → `bg-*`, `text-*`, `border-*`, etc.

- Orange (`accent`) = the protocol only: vault/lock, agent, backer share, accent CTAs, focus. ≤ 5% of a screen.
- `up`/`down` = price/PnL direction and Buy/Sell only. Never statuses, checks or decoration.
- No hex in components, no gradients (except token art and chart fill), no glows, no `backdrop-blur` except the
  sticky header.
- Radius: `rounded-xs` 4 (chips) · `rounded-sm` 8 (buttons, inputs, token images ≤ 48) · `rounded-md` 12 (panels,
  popovers, images ≥ 56) · `rounded-lg` 16 (modals) · `rounded-full` only for dots and people.
- Elevation: panels = `bg-surface border border-line` (no shadow). Popovers/toasts = `bg-raised shadow-pop`.
- Motion: `duration-(--dur-1…6)`, `ease-out` / `ease-in-out` / `ease-spring` / `ease-roll`. Bare `transition` is
  already 100 ms + house easing. Animations: `animate-flash-up|down` (text, 600 ms), `animate-row-up|down|agent`
  (row wash, 800 ms), `animate-outline-up|down` (card outline), `animate-expand-in` (insert; set `--expand-to`),
  `animate-roll-up|down`, `animate-appear` (after 300 ms), `animate-pop-in`, `animate-live` (the one idle pulse per
  page — the header network dot already uses it; don't add another). Reduced motion is handled globally.

## Type (utility classes, desktop values from 768px)

`display-xl` (landing H1) · `display-l` (landing sections, final CTA) · `display-m` (docs H1, app page titles) ·
`h1` (token name) · `h2` (panel titles) · `h3` (card titles) · `body-l` · `body` · `ui` (buttons, nav, tabs) ·
`small` (table cells, meta) · `micro` (axes, timestamps; never body copy) · `label` (the only uppercase; add a colour,
usually `text-ink-3`) · `num-xl` · `num-l` · `num` (tabular figures — use on every changing/aligned number) ·
`num-display` (static marketing numbers ≥ 40px) · `mono` (addresses/signatures/code only).

Rules: ≤ 3 sizes per component, app text ≥ 13px, headings are `text-ink` (never accent), sentence case everywhere.

## Brand — `components/brand/*`

```tsx
import { Mark } from "@/components/brand/mark";           // <Mark size={26} animate="none" | "clamp" | "loop" title? />
import { Lockup } from "@/components/brand/lockup";       // <Lockup size={22} />  (wordmark font-size; ≥ 88px wide, else Mark)
import { ClampLock, ClampLoader } from "@/components/brand/clamp-lock-animation";
// <ClampLock playKey={launch.status} size={40} />  plays the lock when the key changes (launch moment, deposit success)
// <ClampLoader label="Loading launch" />           loop, appears only after 400 ms (route data > 800 ms per §4.12)
import { ClampGlyph, AgentGlyph, BandGlyph, BackerGlyph, RaiseGlyph, RefundGlyph, VerifyGlyph, SplitGlyph } from "@/components/brand/glyphs";
// 16px, stroke 1.5, currentColor. <AgentGlyph outline /> = agent sell marker.
```

Static assets: `public/brand/holdfast-{mark,wordmark,lockup}.svg`, `public/icon-{192,512}.png`, `app/icon.svg`
(+ `icon1.png`, `apple-icon.png`), `app/manifest.ts`. OG images: `import { ogFonts } from "@/lib/og-fonts"` →
families "Mona Sans" (400/600), "Mona Sans Display" (600 = the 640/112.5 display cut), "JetBrains Mono" (400).

## Components — `components/ui/*`

All take `className`. **`cn` appends, it doesn't merge**: never pass a class that fights the component's own
(e.g. `hidden` on a Button that is `inline-flex`, or a second `text-*` colour). Put responsive visibility on a
wrapper element, and pick variants/sizes instead of overriding them.

| Import | What / key props |
|---|---|
| `ui/button` | `Button` `variant="primary\|accent\|secondary\|ghost\|buy\|sell\|danger"` `size="sm\|md\|lg"` (32/40/48; sm → 40 on touch) `busy` (keeps fill, spinner, blocks clicks) vs `disabled` (greys out) `icon` `arrow` (chevron→arrow hover). `ButtonLink` (Next Link), `ButtonAnchor` (external, new tab), `IconButton label=…` (required accessible name), `buttonClass()` |
| `ui/input` | `Input size invalid prefix suffix`, `Textarea`, `Field label hint error aside>{(id) => <Input id={id}/>}</Field>`, `AmountInput value onChange unit onToggleUnit balance onMax presets decimals` (sanitises to digits + one dot) |
| `ui/select` | `Select label prefix value onChange options=[{value,label,hint?}] size align` |
| `ui/tabs` | `Tabs label items=[{value,label,count?}] value onChange` (underline; you render the panel), `Segmented label items=[{value,label,tone?:"up"\|"down"}] size stretch` |
| `ui/table` | `Table density="dense\|comfortable" maxHeight label` · `THead` · `TH align sortable sort onSort` · `TR flash="up\|down\|agent" agent onClick` · `TD align` · `TableMessage colSpan` · `LoadMore hasMore loading onLoadMore` · `useInfiniteScroll({hasMore, loading, onLoadMore, root?})` |
| `ui/tooltip` | `Tooltip content placement` (300 ms, raised, ≤ 280px) · `RuleTooltip rule="Circulating supply × price."` (dotted-underline term; tap on touch) |
| `ui/popover` | `Popover trigger={(p) => <button {...p}/>} role="dialog\|menu\|listbox" placement width label>{(close) => …}</Popover>` (portalled, flips, Esc/outside close) · `MenuItem icon tone="danger" onClick \| href \| href+external` · `MenuSeparator` |
| `ui/dialog` | `Dialog open onOpenChange title description footer width top mobile="sheet\|fullscreen\|dialog" header initialFocus` (bottom sheet below 768 by default) · `Sheet` (always a bottom sheet with drag-to-dismiss) |
| `ui/toast` | `AppToaster` is mounted once in providers. Call `toast` from `sonner`. Transactions toast via `useTx()` |
| `ui/chip` | `Chip tone="neutral\|muted\|faint\|ink\|accent\|warn" icon` (22px, 4px radius, label type) · `StatusChip status="raising\|min-reached\|live\|locked\|refunding\|ended"` · `RoleChip role="creator\|backer\|agent\|holder" detail="4.2% share"` · `StatusDot tone="up\|warn\|down\|unknown" live` |
| `ui/skeleton` | `Skeleton className="h-4 w-24"` (static sunken, appears after 300 ms; `immediate` in `loading.tsx`) |
| `ui/empty-state` | `EmptyState action={…}>No raises open.</EmptyState>` · `ErrorState onRetry retrying>Couldn't load trades. Indexer unreachable.</ErrorState>` |
| `ui/stat` | `Stat label rule value sub size="m\|l\|xl" tone="warn\|accent"` · `StatRow scroll` (1px-ruled strip, 2-col on mobile) · `HeadlineStat stat value label format context` (§5.3 gate, see below) |
| `ui/address` | `Address address kind="address\|tx" label chars href peek identicon copy explorer` — click = peek popover (320px) › `href` › copy. `CopyButton value label` |
| `ui/identicon` | `Identicon address size src?` (avatar URL replaces the pattern) |
| `ui/token-avatar` | `TokenAvatar src symbol mint size` (8/12px radius by size, fallback tile from mint, fade-in) |
| `ui/countdown` | `Countdown to prefix="Closes in" endedLabel warnBelowSecs` ("2d 04h 07m", warn < 1h) · `formatCountdown(secs)` |
| `ui/number-ticker` | `NumberTicker value format roll? flash?` — flashes up/down only when the *displayed* text changes; `roll` for hero/stat numbers, never table cells |
| `ui/progress` | `ProgressBar value max min size="sm\|md" minLabel="min 2"` (ink → accent once min is reached) |
| `ui/sparkline` | `Sparkline values className` — renders "—" under 12 points |
| `ui/spinner` | `Spinner label?` |

Example panel:

```tsx
<section className="rounded-md border border-line bg-surface">
  <header className="flex items-center justify-between px-4 py-3">
    <h2 className="h2">Trades</h2>
    <Segmented label="Side" size="sm" value={side} onChange={setSide} items={[{ value: "all", label: "All" }, { value: "buys", label: "Buys" }]} />
  </header>
  <Table density="dense" maxHeight={480} label="Trades">…</Table>
</section>
```

## Shell, wallet, search — `components/shell/*`, `components/search/*`

- Wallet modal: `useWalletModal().setVisible(true)` from `@solana/wallet-adapter-react-ui` opens **our** modal
  (`WalletModalProvider` supplies that context). Don't import the adapter UI's components or CSS.
- `WalletButton`, `FaucetButton`, `useAirdrop()` (`shell/faucet`), `NetworkPill`, `StatusBar`, `LiveEyebrow`
  ("● Live on Solana devnet") are reusable.
- Command palette: ⌘K / Ctrl+K / `/`. Open it programmatically with `useCommandPalette().setOpen(true)`
  (`components/search/command-palette`). `SearchTrigger` / `SearchIconButton` are the header entry points.
- Profile links go to `/u/<wallet>`, token links to `/launch/<mint>`. Footer links expect these docs slugs:
  `how-it-works, vault-and-agent, fees, api, program, brand, risks`.

## Lib additions

- `lib/thresholds.ts` — §5.3: `HEADLINE_MIN`, `headlineSlot(stat, value, { backerFeeShareBps })`,
  `invariantFor`, `clearsHeadline`; plus `CONCENTRATION_WARN`, `IMPACT_WARN_PCT`/`IMPACT_DANGER_PCT`,
  `SPARKLINE_MIN_POINTS`. Headline slots only; tables/detail pages always show real values.
- `lib/status.ts` — `useIndexerStatus()` (`/api/health`: up / warn when lag ≥ 150 or syncing / down) and
  `useAgentHeartbeat()` (agent `/status`: online ≤ 60 s since last tick, stale, offline).
- `lib/tx.tsx` — `useTx()` now also returns `stage` (`preparing|signing|sending|confirming`); show
  `TX_STAGE_LABEL[stage]` on the busy button. `ExplorerLink` is exported for toasts.
- `lib/api.ts` — `api.health()`, `api.search(q)`; `lib/query-options.ts` — `healthQuery()`, `searchQuery(q)`.
- `lib/theme.ts` — `THEME_COLOR` (meta theme-color), identicon/tile tones, `hashString`.
- `lib/burner.ts` — the test wallet; its key lives in `holdfast:burner-secret` (migrated from `moshsol:burner-secret`).

## Do / don't

- Do: one sentence + one action for empty states; errors say what happened and what to do next; `$TICKER` always
  with `$`; "the vault agent" (never AI/bot); render limits from `launch.terms` / `/api/platform`, never typed.
- Do: sentence-case buttons with real verbs ("Back this launch", "Buy $MOSH", "Claim 0.42 SOL").
- Don't: cards in cards, icons in tinted tiles, pill buttons/tabs, uppercase headings, flip clocks, shine sweeps,
  marquees, USD on devnet, zero-value headline stats, more than one accent/primary button per region.

## Temporary (delete when the last pre-rebrand page is replaced)

`app/legacy.css` (old token names → new tokens, `.card/.field/.data-table/…`) and `components/legacy/*` (old
Button/Card/Badge/etc.) exist only so un-migrated pages keep working. New code must not import or use them. When
`grep -r "components/legacy\|text-muted\|text-dim" src` is empty, delete both and the `@import "./legacy.css"`.
