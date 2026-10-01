# Holdfast indexer API

Base URL: `NEXT_PUBLIC_INDEXER_URL` (mainnet: `https://indexer-mainnet-bd1f.up.railway.app`; devnet: `https://indexer-production-454b.up.railway.app`). Everything is JSON
over HTTP plus one WebSocket (`/ws`). CORS is open (`*`; methods `GET POST PUT DELETE OPTIONS`).

## Conventions

- **Addresses** are canonical base58 public keys. A non-canonical/invalid key in a path or query → `400`.
- **Amounts.** Strings are raw integers: lamports for SOL (`"50000000"` = 0.05 SOL) and token base units
  (6 decimals; supply `1000000000000000`). Numbers whose name ends in `Sol` are SOL as floats
  (`volume24hSol: 0.0447`). `priceSol` / `emaSol` are SOL per whole token.
- **Time** is unix seconds.
- **Errors** are `{ "error": "<human readable message>" }` with the status code:

  | Status | When |
  |---|---|
  | `400` | Invalid parameter/body, malformed signed message, content that fails validation |
  | `401` | Bad signature, signed timestamp outside ±300 s, missing/wrong admin token |
  | `404` | Unknown launch / comment / route |
  | `409` | Replayed signed message, duplicate comment, profile name taken |
  | `413` | Body larger than the route limit (16 KB for signed writes, 4 MB images) |
  | `429` | Rate limit; `Retry-After` header holds the seconds to wait |
  | `500` | Internal error (`"internal server error"`) |
  | `503` | `/api/health` while unhealthy; `DELETE /api/comments/:id` when moderation is disabled |

- **Pagination** uses `before` cursors (exclusive): a unix timestamp for chain data (trades, deposits, activity) and a
  comment id for comments. Responses that page return `nextBefore` (`null` on the last page).

### Rate limits

| Limit | Default | Env | Scope |
|---|---|---|---|
| All routes | 1200/min | `RATE_LIMIT_PER_MIN` | per IP |
| `POST /api/upload`, `POST /api/upload/image` | 20/min | `UPLOAD_LIMIT_PER_MIN` | per IP (on top of the global limit) |
| Signed writes (`POST …/comments`, `PUT /api/users/:wallet`) | 20/min | `SOCIAL_IP_LIMIT_PER_MIN` | per IP, every attempt counts |
| Comments | 5/min | `COMMENT_LIMIT_PER_MIN` | per wallet, counted after the signature verified |
| Profile updates | 10/min | — | per wallet, counted after the signature verified |

`0` disables an env-configurable limit. Behind a proxy set `TRUST_PROXY` (trusted proxy list such as `uniquelocal`,
or `1`) so the client IP comes from `X-Forwarded-For`. Fixed one-minute windows; the `429` body says how long to wait.

---

## Signed messages (comments, profiles)

Writes are authenticated by an Ed25519 signature of the posting wallet over a canonical 4-line UTF-8 message
(no trailing newline):

```
holdfast:<kind>:v1
<subject>
<sha256 of the payload, lowercase hex>
<unix seconds>
```

| kind | subject | payload hashed |
|---|---|---|
| `comment` | the launch **address** (a pump launch has no mint of its own while raising) | the `body` string exactly as sent in the request |
| `profile` | the wallet itself | the `profile` JSON string exactly as sent in the request |

Rules enforced by the server:

- the message must match the request exactly (kind, subject, hash) → else `400`;
- the timestamp must be within **±300 s** of the server clock → else `401`;
- `signature` is the **base58** 64-byte signature of the message bytes by `wallet` → else `401 invalid signature`;
- every signed message is accepted **once** per wallet (`409` on replay); sign a fresh message (new timestamp) per request.

Browser example (Solana wallet adapter; `bs58` from npm):

```ts
import bs58 from "bs58";

async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function postComment(indexer: string, mint: string, body: string, wallet: WalletContextState, replyTo?: number) {
  const ts = Math.floor(Date.now() / 1000);
  const message = `holdfast:comment:v1\n${mint}\n${await sha256Hex(body)}\n${ts}`;
  const signature = bs58.encode(await wallet.signMessage!(new TextEncoder().encode(message)));
  const res = await fetch(`${indexer}/api/launches/${mint}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: wallet.publicKey!.toBase58(), message, signature, body, replyTo }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return (await res.json()).comment;
}

async function saveProfile(indexer: string, wallet: WalletContextState, p: { name?: string; bio?: string; avatar?: string }) {
  const address = wallet.publicKey!.toBase58();
  const profile = JSON.stringify(p); // hash and send this exact string
  const message = `holdfast:profile:v1\n${address}\n${await sha256Hex(profile)}\n${Math.floor(Date.now() / 1000)}`;
  const signature = bs58.encode(await wallet.signMessage!(new TextEncoder().encode(message)));
  return fetch(`${indexer}/api/users/${address}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature, profile }),
  });
}
```

---

## WebSocket `/ws`

Connect to `ws(s)://<indexer>/ws`. The server only pushes (client messages are ignored) and pings every 30 s
(standard ping/pong; browsers answer automatically). Messages are JSON:

| `type` | Shape | When |
|---|---|---|
| `event` | `{ type, event: ActivityEvent }` | A new on-chain event was indexed (trade, deposit, launch, claim, crank, …) |
| `launch` | `{ type, launch: LaunchSummary }` | A launch's summary changed (every touching event, holder refresh, metadata, venue price poll) |
| `comment` | `{ type, launch, comment: Comment }` | A comment was posted (`launch` = launch address) |
| `comment_deleted` | `{ type, launch, id }` | A moderator removed a comment |
| `reset` | `{ type, genesisHash }` | Chain reset: the index (including comments) was rebuilt — drop caches and refetch |

```json
{ "type": "comment", "launch": "ChpzEmQQ5f3Y2hTh8cf3nqWx7tK6P4XQ6K9m3LpJx9uZ",
  "comment": { "id": 15, "launch": "ChpzEmQQ5f3Y2hTh8cf3nqWx7tK6P4XQ6K9m3LpJx9uZ",
    "mint": "EJzhfMxfUFwZeSaa4ZBujqJ6PuBAtpQjFRyRN9cko4y1",
    "wallet": "FwYLuQQev8VnGnXySMd7NSJvSYwqhe3tgcdyWzEVpnAs", "name": "holdfast_dev", "avatar": null,
    "body": "creator here — backers get the vault's profit", "replyTo": null, "replyCount": 0, "createdAt": 1790498155,
    "isCreator": true, "isBacker": true, "holdsTokens": false } }
```

---

## Shared types

### LaunchSummary

Returned by the launch list/detail endpoints, `/api/trending` and the `launch` WS message. It is the on-chain
`Launch` account snapshot (`LaunchJson` from `@holdfast/sdk`: `venue`, `createKey`, `pump.{bondingCurve,pool,graduated}`,
`buybackPoolSol`, `creatorFeesCollected`, `burnedSol`, `burnedTokens`, `lastBuybackTs`, on-chain `name`/`symbol`/`uri`, …)
plus indexer fields.

**Venues.** `venue` is `holdfast` (trades on this program's own curve; the two original mainnet launches) or `pump`
(a pump.fun token the launch created; trading happens on pump.fun, then on PumpSwap once `pump.graduated`). A pump
launch has **no mint until it launches**: `mint` is the default pubkey `11111111111111111111111111111111` while
raising/refunding, so key pump launches by `address` (see `:id` below). For pump launches the indexer overwrites the
snapshot's `priceSol` / `marketCapSol` with the venue's reserves — bonding curve `virtualSol / virtualToken` before
graduation, PumpSwap pool `quote / base` balances after — re-read on every full refresh (`FULL_REFRESH_MS`) and every
touching event, so `change24h`, sorting and stats work the same on both venues; `emaSol` stays the account's own sample.
Between the curve completing and `graduate_pump` recording the pool there is nothing to quote and the last price is kept.

```json
{
  "address": "62dtus18U6vSSDB6srjyU5peibfYMQKTHDcATx6Rn3Wg",
  "mint": "DRoHKBY6hAszKSBm8fey8AZqMDzPexkgYPSNeyZdHJNv",
  "creator": "Ckbc9MpvAjeuPLgtcKpNCEdAKEoDqDahyhNa3L254iq",
  "index": 1, "status": "live", "createdAt": 1790425547, "launchedAt": 1790425741,
  "terms": { "tradeFeeBps": 100, "backerFeeShareBps": 5000, "creatorFeeShareBps": 3000, "launchFeeBps": 100,
    "agentBuyBpsPerWindow": 1000, "agentSellBpsPerWindow": 500, "agentMaxImpactBps": 300, "agentBandBps": 200,
    "agentWindowSecs": 3600, "emaPeriodSecs": 1800 },
  "raiseMin": "50000000", "raiseMax": "100000000", "maxPerWallet": "0", "raiseDeadline": 1790426147,
  "raised": "50000000", "refunded": "0", "backerCount": 1, "whitelisted": false,
  "whitelistRoot": "0000000000000000000000000000000000000000000000000000000000000000",
  "bundleSupplyBps": 1500, "reserveBps": 3000,
  "virtualSol": "30000000000", "realSol": "49492682", "tokenReserve": "998352961176926",
  "vaultSol": "14850000", "vaultTokens": "1153667514021", "bundleSol": "34650000", "bundleTokens": "1153667514021",
  "vaultCostSol": "34650000", "accFeePerShare": "4485720000000000",
  "backerFeesAccrued": "224286", "backerFeesClaimed": "224286", "creatorFeesUnclaimed": "0",
  "creatorFeesClaimed": "134571", "platformFeesUnclaimed": "589716",
  "windowStart": 1790425741, "windowBuyCap": "1485000", "windowSolSpent": "0", "windowSellCap": "57683375701",
  "windowTokensSold": "0", "emaPriceQ64": "554685671522617", "lastTradeTs": 1790425767,
  "agentBuys": 0, "agentSells": 0, "agentSolSpent": "0", "agentSolReceived": "0", "agentTokensSold": "0",
  "buybackSol": "0", "volumeSol": "79507318", "tradeCount": 3,
  "priceSol": 3.0099e-8, "emaSol": 3.0069e-8, "marketCapSol": 30.099, "vaultAvgCostSol": 3.0035e-8, "agentAvgSellSol": null,

  "name": "Volt Runner", "symbol": "VOLT",
  "uri": "https://arweave.net/hp8woHsE05aHWC2h2YbKfviXZqwHklBosmPrnu-_L8M",
  "image": "https://arweave.net/ps0oiQxryglEGw3f0LRnrfpDfSsC3FcldSSaCA7nO3g",
  "description": "Live-site test launch.", "twitter": "https://x.com/moshsol", "telegram": null,
  "website": null, "whitelist": null,
  "change24h": 0.0998,
  "volume24hSol": 0.044708745,
  "volume1hSol": 0,
  "trades1h": 0,
  "buyers24h": 1,
  "sellers24h": 1,
  "lastTradeAt": 1790425767,
  "holders": 1,
  "topHolderPct": 0.0493,
  "comments": 0,
  "creatorName": null,
  "profitSharedSol": 0,
  "vaultWithdrawnSol": 0,
  "vaultWithdrawnTokens": "0",
  "woundDown": null,
  "graduation": null,
  "cranks": { "creatorFeeCollections": 0, "buybacks": 0, "lastCollectedAt": null, "lastBuybackAt": null }
}
```

| Indexer field | Meaning |
|---|---|
| `name`, `symbol`, `image`, `description`, `twitter`, `telegram`, `website`, `whitelist` | From the metadata JSON at `uri` (on-chain name/symbol until it loads; pump launches carry name/symbol/uri on the launch account, Holdfast launches on the mint) |
| `change24h` | % price change vs the last trade ≥24 h ago (vs the launch price for younger launches); `null` unless live. On pump launches only agent trades are indexed, so the reference is usually the launch price |
| `volume24hSol`, `volume1hSol` | SOL traded in the window through this program (agent trades included; public pump.fun trades are not indexed) |
| `trades1h` | Trades in the last hour (agent trades included) |
| `buyers24h`, `sellers24h` | Distinct non-agent wallets that bought / sold in the last 24 h |
| `lastTradeAt` | Last indexed trade (`null` if none) |
| `holders` | Wallets with a non-zero balance (the venue's own token account and the vault excluded); 0 for a pump launch without a mint |
| `topHolderPct` | Largest holder's % of total supply, venue and vault excluded; `null` until holders were first loaded |
| `comments` | Visible comments |
| `creatorName` | The creator's profile name, `null` if unset |
| `profitSharedSol` | SOL of the vault agent's realized profit shared out (sum of `VaultProfitShared` events; 100% to backers on Holdfast launches, 75% backers / 25% buyback pool on pump launches) |
| `vaultWithdrawnSol`, `vaultWithdrawnTokens` | Vault SOL / tokens (base units) the platform admin withdrew with `admin_withdraw_vault` (sum of `VaultWithdrawn`); each withdrawal is listed by `GET /api/launches/:id/activity?type=vault_withdrawn` |
| `woundDown` | `{ timestamp, solToBackers, tokensReturned, signature }` from the `WoundDown` event (`solToBackers` in SOL, `tokensReturned` base units); `null` if not wound down (or the event predates the indexed history) |
| `graduation` | Pump launches: `{ timestamp, signature, pool }` from the `PumpGraduated` event (`graduate_pump` recorded the PumpSwap pool); `null` before (and always on Holdfast launches) |
| `cranks` | Pump launches: `{ creatorFeeCollections, buybacks, lastCollectedAt, lastBuybackAt }` — counts and last unix times of the indexed `CreatorFeesCollected` (`collect_pump_fees`) and `BuybackBurned` (`buyback_burn`) events; the SOL totals are the snapshot's `creatorFeesCollected`, `burnedSol`, `burnedTokens`, `buybackPoolSol` |

`status` is `raising` (raise open or awaiting launch), `live` (trading), `refunding` (cancelled/failed raise) or
`woundDown` (permissionless `wind_down` ran: trading stopped for good, curve + vault SOL were credited to backers).

`backerFeesAccrued` and `accFeePerShare` include every backer credit: the backer fee share, 100% of the vault agent's
realized profit and the wind-down payout. A backer's claimable amount (`/backers`, `/portfolio`, `/users`) is
`deposited × accFeePerShare − feesClaimed`, so it covers all three; `claim_backer_fees` pays them in one claim.

### TradeRow

```json
{ "signature": "5x…", "slot": 504700000, "timestamp": 1790425767,
  "trader": "Ckbc9MpvAjeuPLgtcKpNCEdAKEoDqDahyhNa3L254iq", "isBuy": false, "isAgent": false,
  "solAmount": "14708593", "tokenAmount": "493371309053", "fee": "147085",
  "priceSol": 3.0099e-8, "emaSol": 3.0069e-8, "vaultSol": "14850000", "vaultTokens": "1153667514021",
  "realSol": "49492682", "tokenReserve": "998352961176926" }
```

`priceSol`/`emaSol` and the reserve fields are the state right after the trade.

### ActivityEvent

```json
{ "id": "3NR4…vs6m:0", "type": "deposit", "signature": "3NR4…vs6m", "timestamp": 1790425997,
  "launch": "HNCt4NhXq1cD7Yk2jv5sUw9bTq3aG8nR6pL2mZ4eF7vK", "venue": "holdfast",
  "mint": "A824aq2CUztjDr1oDsCg8ZRWYrJ8jb5yeRdTkj2bcE5n", "symbol": "FROG", "name": "Lily Frog",
  "image": "https://…/files/img/I9sdWZ9jbnLZ.svg", "actor": "FwYLuQQev8VnGnXySMd7NSJvSYwqhe3tgcdyWzEVpnAs",
  "solAmount": "30000000" }
```

`launch` is the launch address (the stable key; `mint` is the default pubkey on a pump launch that hasn't launched).
`type`: `trade`, `deposit`, `launch_created`, `launched`, `refund`, `cancelled`, `backer_claim`, `creator_claim`,
`profit_shared`, `wound_down`, `vault_withdrawn`, and on pump launches `creator_fees_collected` (`collect_pump_fees`
swept pump.fun / PumpSwap creator fees into the launch), `buyback_burned` (`buyback_burn` bought and burned the
platform's buyback token), `graduated` (`graduate_pump` recorded the PumpSwap pool) and `migrated` (the admin's one-time
layout migration after the program upgrade).
`actor` is the trader/backer/creator (the launch creator for the launch-level `launched`/`cancelled`/`profit_shared`/
`wound_down`/`creator_fees_collected`/`buyback_burned`/`graduated`/`migrated`; the platform fee recipient for
`vault_withdrawn`). Optional: `isAgent`, `isBuy` (trades), `solAmount` (lamports: trade/deposit/claim amounts, the
profit credited for `profit_shared`, curve + vault SOL credited to backers for `wound_down`, vault SOL withdrawn for
`vault_withdrawn`, creator fees collected for `creator_fees_collected`, SOL spent for `buyback_burned`), `tokenAmount`
(trades, `launched`; tokens returned to the curve for `wound_down`; vault tokens withdrawn for `vault_withdrawn`; tokens
burned for `buyback_burned`), `ref` (the PumpSwap pool for `graduated`; the mint burned for `buyback_burned`).

### Comment

```json
{ "id": 3, "launch": "ChpzEmQQ5f3Y2hTh8cf3nqWx7tK6P4XQ6K9m3LpJx9uZ", "mint": "DRoHKBY6hAszKSBm8fey8AZqMDzPexkgYPSNeyZdHJNv",
  "wallet": "HQru7X9aGHafTxr8S2NbNPiaei4RryhJiJgjoK13ATGS", "name": "bs_HQru7X", "avatar": "https://…/files/img/Oe7_XRPbyQ_J.png",
  "body": "gm holders", "replyTo": null, "replyCount": 1, "createdAt": 1790498023,
  "isCreator": false, "isBacker": false, "holdsTokens": false }
```

| Field | Meaning |
|---|---|
| `launch`, `mint` | The launch's address (what comments are keyed by) and its current mint |
| `wallet`, `name`, `avatar` | Author and their profile name/avatar (`null` when unset) |
| `body` | Trimmed text, control characters stripped, ≤500 chars, newlines kept (max one blank line) — render as plain text |
| `replyTo` | Id of the comment it answers (same launch); it may have been removed by a moderator since |
| `replyCount` | Visible replies |
| `isCreator` | Author created the launch |
| `isBacker` | Author deposited into the raise |
| `holdsTokens` | Author holds the token now: from the holder snapshot when one is cached (exact), else net curve buys > sells (tokens received by transfer are not seen). Best effort |

---

## Health & platform

### `GET /api/health`

`200` healthy, `503` when the RPC is unreachable or the first sync hasn't finished (same body plus `error`).

```json
{ "ok": true, "slot": 504720663, "programId": "EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ",
  "lastIndexedSlot": 504720652, "lagSlots": 11, "wsConnected": true,
  "genesisHash": "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" }
```

### `GET /api/platform`

Global platform account (`404` if not initialized). Use a launch's `terms`, not these params, for quotes.
`holdfastCurveEnabled` says whether `create_launch` (Holdfast curve) is still open — false on mainnet, where new
launches are pump.fun tokens (`create_launch_pump`); `burnShareBps` is the share of a pump launch's creator fees and of
the agent's realized profit that goes to its buyback-and-burn pool; `buybackMint` is the token `buyback_burn` buys and
burns (the default pubkey `11111111111111111111111111111111` while unset: pools accrue, the crank refuses).

```json
{ "address": "675WZQsKXyFfCXD2a2iQdhFdYFdgz8HWiCJwrcCBuUgs", "admin": "FwYL…", "feeRecipient": "J2zc…",
  "agentAuthority": "3qLL…", "launchCount": 4,
  "params": { "tradeFeeBps": 100, "backerFeeShareBps": 5000, "creatorFeeShareBps": 3000, "launchFeeBps": 100,
    "createFeeLamports": "5000000", "virtualSolReserves": "30000000000", "maxBundleSupplyBps": 2500,
    "minRaiseLamports": "50000000", "agentBuyBpsPerWindow": 1000, "agentSellBpsPerWindow": 500,
    "agentMaxImpactBps": 300, "agentBandBps": 200, "agentWindowSecs": 3600, "emaPeriodSecs": 1800,
    "paused": false, "agentsPaused": false, "maxRaiseLamports": "0", "maxWalletDepositLamports": "0",
    "holdfastCurveEnabled": false, "burnShareBps": 2500, "buybackMint": "11111111111111111111111111111111" } }
```

### `GET /api/stats`

```json
{ "totalLaunches": 4, "liveLaunches": 2, "raisingLaunches": 1, "woundDownLaunches": 0, "pumpLaunches": 2,
  "totalRaisedSol": 1.08, "totalVolumeSol": 0.817, "volume24hSol": 0.089, "backerFeesAccruedSol": 0.000449,
  "profitSharedSol": 0, "agentTrades": 0, "vaultSol": 0.312, "vaultTokensValueSol": 0.744, "vaultWithdrawnSol": 0,
  "buybackPoolSol": 0.05, "burnedSol": 0.12, "creatorFeesCollectedSol": 0.68 }
```

`backerFeesAccruedSol` is everything credited to backers (fee share + vault profit share + wind-down payouts);
`profitSharedSol` is the vault-profit part. `vaultSol` / `vaultTokensValueSol` are what the vaults hold now (tokens at
spot / venue price); `vaultWithdrawnSol` is the SOL the platform admin has withdrawn from vaults with
`admin_withdraw_vault`. `pumpLaunches` counts launches with `venue: "pump"`; `buybackPoolSol` (SOL waiting for
`buyback_burn`), `burnedSol` (SOL already spent on buybacks) and `creatorFeesCollectedSol` (pump.fun / PumpSwap creator
fees swept in) are sums over the launch snapshots.

---

## Launches

### The `:id` parameter

Every `/api/launches/:id…` route below resolves `:id` as the launch **address or its mint**. Pump launches have no mint
until they launch (their `mint` is the default pubkey, which never resolves), so link them by `address`
(`/launch/<venue === "pump" ? address : mint>` on the web); Holdfast launches keep working by mint. The response always
carries both `address` and `mint`.

### `GET /api/launches`

| Query | Default | |
|---|---|---|
| `status` | `all` | `raising` \| `live` \| `refunding` \| `woundDown` \| `all` |
| `sort` | `new` | `new` \| `trending` (`volume1hSol + 0.25 × volume24hSol`) \| `volume` (24 h) \| `mcap` \| `raised` |
| `q` | — | Case-insensitive substring of name, symbol, mint or address |
| `limit` / `offset` | `50` / `0` | `limit` ≤ 200 |

→ `{ "launches": LaunchSummary[], "total": 4 }` (`total` counts all matches before paging).

### `GET /api/launches/:id`

→ `LaunchSummary`. `404` unknown id.

### `GET /api/launches/:id/activity?type=&before=&limit=`

The launch's indexed events, newest first. `type` narrows to one `ActivityEvent` type (`400` if unknown), e.g.
`type=vault_withdrawn` lists every admin vault withdrawal (`actor` = recipient, `solAmount` lamports,
`tokenAmount` base units, `signature` = the transaction). `limit` default 50, ≤ 500; `before` unix seconds.
→ `{ "events": ActivityEvent[] }`

### `GET /api/launches/:id/trades`

Newest first.

| Query | Default | |
|---|---|---|
| `limit` | `100` | ≤ 500 |
| `before` | — | Unix seconds, exclusive (page with the last row's `timestamp`) |
| `agent` | `0` | `1` = vault-agent trades only |
| `side` | `all` | `buy` \| `sell` \| `all` |
| `minSol` | — | Only trades of at least this many SOL (float ≥ 0) |
| `trader` | — | Only this wallet's trades |

→ `{ "trades": TradeRow[] }`. `400` on an invalid `side`/`minSol`/`trader`.

### `GET /api/launches/:id/traders`

Top non-agent traders of the launch by SOL volume.

| Query | Default | |
|---|---|---|
| `window` | `24h` | `24h` \| `7d` \| `all` |
| `limit` | `20` | ≤ 100 |

```json
{ "window": "24h",
  "traders": [ { "wallet": "Ckbc9MpvAjeuPLgtcKpNCEdAKEoDqDahyhNa3L254iq", "name": null, "avatar": null,
    "trades": 2, "buys": 1, "sells": 1, "buySol": 0.03, "sellSol": 0.0147, "volumeSol": 0.0447,
    "netSol": -0.0153, "netTokens": "493371309053", "lastTradeAt": 1790425767 } ] }
```

`netSol` = sold − bought (cash flow, not PnL); `netTokens` = bought − sold in base units (string, may be negative).

### `GET /api/launches/:id/candles?tf=`

`tf` seconds: `60` (default), `300`, `900`, `3600`, `86400`. Starts at the launch (bundle) price; each candle opens at
the previous close.

```json
{ "candles": [ { "time": 1790424000, "open": 3.0069e-8, "high": 3.0128e-8, "low": 3.0069e-8, "close": 3.0099e-8,
  "volumeSol": 0.0794 } ] }
```

### `GET /api/launches/:id/backers`

Live from chain (one RPC call). Sorted by deposit.

```json
{ "backers": [ { "owner": "Ckbc…", "deposited": "50000000", "feesClaimed": "224286", "claimable": "0", "shareBps": 10000 } ] }
```

### `GET /api/launches/:id/deposits?before=&limit=`

`limit` default 50, ≤ 500; `before` unix seconds.

```json
{ "deposits": [ { "signature": "5ZYy…", "timestamp": 1790425601, "backer": "Ckbc…", "amount": "50000000", "raised": "50000000" } ] }
```

### `GET /api/launches/:id/holders?limit=`

`limit` default 20, ≤ 1000. Cached per launch (`HOLDERS_TTL_MS`). `label` marks the venue's and the vault's token
accounts: `curve` (Holdfast curve PDA, or the pump.fun bonding curve's ATA), `pool` (the PumpSwap pool's base account
once graduated) and `vault` (vault PDA, or the pump authority's ATA); they are never counted as holders. Holdfast
launches are Token-2022 mints, pump launches SPL Token mints. `{ "holders": [] }` for a pump launch that hasn't launched.

```json
{ "holders": [
  { "owner": "6KH6gY4usQ3h2tekZf814fS2UwYF6kvZHt9eAhTGEEe", "amount": "998352961176926", "pct": 99.8352, "label": "curve" },
  { "owner": "BKtK3TT3TTaLtDCysMSt2SAK9Ggztj7TW4YXkceZtdft", "amount": "1153667514021", "pct": 0.1153, "label": "vault" },
  { "owner": "Ckbc9MpvAjeuPLgtcKpNCEdAKEoDqDahyhNa3L254iq", "amount": "493371309053", "pct": 0.0493, "label": null } ] }
```

---

## Comments

### `GET /api/launches/:id/comments`

Flat thread, newest first (replies included, linked by `replyTo`).

| Query | Default | |
|---|---|---|
| `limit` | `50` | ≤ 200 |
| `before` | — | Comment id, exclusive (use `nextBefore`) |
| `replyTo` | — | Only the replies to this comment id |

```json
{ "comments": [ Comment, … ], "total": 3, "nextBefore": 2 }
```

`total` = visible comments on the launch. `404` unknown launch.

### `GET /api/comments/:id`

→ `{ "comment": Comment }`. `404` if unknown or removed.

### `POST /api/launches/:id/comments`

Body (JSON, ≤ 16 KB):

```json
{ "wallet": "HQru7X9aGHafTxr8S2NbNPiaei4RryhJiJgjoK13ATGS",
  "message": "holdfast:comment:v1\nChpzEmQQ5f3Y2hTh8cf3nqWx7tK6P4XQ6K9m3LpJx9uZ\n<sha256(body) hex>\n1790498023",
  "signature": "<base58 ed25519 signature of message>",
  "body": "gm holders",
  "replyTo": 1 }
```

`201` → `{ "comment": Comment }`, and every `/ws` client receives `{ type: "comment", launch, comment }`.

| Status | Error (examples) |
|---|---|
| `400` | `body must not be empty`, `body must be at most 500 characters`, `wallet is required (string)`, `invalid wallet`, `message is signed for <X>, not <launch address>`, `message hash does not match the submitted content`, `signature must be a base58-encoded 64-byte Ed25519 signature`, `replyTo must be a visible comment on this launch` |
| `401` | `invalid signature`, `message timestamp is outside ±300s of server time (<now>)` |
| `404` | `launch not found` |
| `409` | `this signed message was already used; sign a new one`, `you already posted this comment here recently` (same wallet + launch + text within 10 min) |
| `429` | `too many comments from this wallet (5/min); retry in 42s`, `too many signed writes from this IP (20/min); retry in 42s` |

Comments are allowed on any indexed launch (raising, live or refunding). The server stores the signed message and
signature with the comment (not exposed by the API).

### `DELETE /api/comments/:id` (moderation)

Header `x-admin-token: <ADMIN_TOKEN>`. Soft delete: the comment disappears from every read and counts, and
`/ws` clients receive `{ type: "comment_deleted", launch, id }`. Idempotent.

```json
{ "ok": true, "id": 1, "launch": "ChpzEmQQ5f3Y2hTh8cf3nqWx7tK6P4XQ6K9m3LpJx9uZ", "mint": "DRoHKBY6hAszKSBm8fey8AZqMDzPexkgYPSNeyZdHJNv",
  "deletedAt": 1790498024, "alreadyDeleted": false }
```

| Status | Error |
|---|---|
| `401` | `invalid admin token` (missing or wrong header) |
| `404` | `comment not found` |
| `503` | `moderation is disabled (ADMIN_TOKEN is not set)` |

---

## Users

A user is any wallet; profiles are optional. Profiles survive chain resets (comments don't: their launches are gone).

### `GET /api/users/:wallet`

Profile + stats, all from indexed data (no RPC call). Works for any valid wallet (zeros when unseen).

```json
{
  "wallet": "FwYLuQQev8VnGnXySMd7NSJvSYwqhe3tgcdyWzEVpnAs",
  "name": "holdfast_dev", "bio": "creator of MOSH", "avatar": null, "profileUpdatedAt": 1790498155,
  "stats": {
    "launchesCreated": 2, "launchesByStatus": { "raising": 1, "live": 1, "refunding": 0, "woundDown": 0 },
    "raisedSol": 1.03,
    "backedLaunches": 2, "depositedSol": 1.03, "refundedSol": 0,
    "backerFeesEarnedSol": 0.000224285, "backerFeesClaimedSol": 0, "backerFeesClaimableSol": 0.000224285,
    "creatorFeesEarnedSol": 0.000134571, "creatorFeesClaimedSol": 0, "creatorFeesUnclaimedSol": 0.000134571,
    "trades": 0, "buys": 0, "sells": 0, "volumeSol": 0, "buyVolumeSol": 0, "sellVolumeSol": 0, "launchesTraded": 0,
    "comments": 0, "firstSeen": 1790412385
  },
  "launches": [
    { "address": "HNCt4NhXq1cD7Yk2jv5sUw9bTq3aG8nR6pL2mZ4eF7vK", "venue": "holdfast", "mint": "A824aq2CUztjDr1oDsCg8ZRWYrJ8jb5yeRdTkj2bcE5n", "name": "Lily Frog", "symbol": "FROG",
      "image": "https://arweave.net/ps0oiQxryglEGw3f0LRnrfpDfSsC3FcldSSaCA7nO3g", "status": "raising",
      "createdAt": 1790425994, "raised": "30000000", "raisedSol": 0.03, "raiseMin": "200000000", "raiseMax": "1000000000",
      "backerCount": 1, "priceSol": 2.9999e-8, "marketCapSol": 29.999, "volume24hSol": 0, "creatorFeesEarnedSol": 0 },
    { "address": "62dtus18U6vSSDB6srjyU5peibfYMQKTHDcATx6Rn3Wg", "venue": "holdfast", "mint": "EJzhfMxfUFwZeSaa4ZBujqJ6PuBAtpQjFRyRN9cko4y1", "name": "Moshpit", "symbol": "MOSH",
      "image": "https://arweave.net/ps0oiQxryglEGw3f0LRnrfpDfSsC3FcldSSaCA7nO3g", "status": "live",
      "createdAt": 1790412385, "raised": "1000000000", "raisedSol": 1, "raiseMin": "1000000000", "raiseMax": "1000000000",
      "backerCount": 1, "priceSol": 3.1432e-8, "marketCapSol": 31.432, "volume24hSol": 0.044708593,
      "creatorFeesEarnedSol": 0.000134571 }
  ],
  "backed": [
    { "address": "62dtus18U6vSSDB6srjyU5peibfYMQKTHDcATx6Rn3Wg", "venue": "holdfast", "mint": "EJzhfMxfUFwZeSaa4ZBujqJ6PuBAtpQjFRyRN9cko4y1", "name": "Moshpit", "symbol": "MOSH",
      "image": "https://arweave.net/ps0oiQxryglEGw3f0LRnrfpDfSsC3FcldSSaCA7nO3g", "status": "live",
      "depositedSol": 1, "shareBps": 10000, "feesEarnedSol": 0.000224285, "feesClaimableSol": 0.000224285,
      "firstDepositAt": 1790412386 },
    { "address": "HNCt4NhXq1cD7Yk2jv5sUw9bTq3aG8nR6pL2mZ4eF7vK", "venue": "holdfast", "mint": "A824aq2CUztjDr1oDsCg8ZRWYrJ8jb5yeRdTkj2bcE5n", "name": "Lily Frog", "symbol": "FROG",
      "image": "https://arweave.net/ps0oiQxryglEGw3f0LRnrfpDfSsC3FcldSSaCA7nO3g", "status": "raising",
      "depositedSol": 0.03, "shareBps": 10000, "feesEarnedSol": 0, "feesClaimableSol": 0, "firstDepositAt": 1790425997 }
  ]
}
```

| Stat | Definition |
|---|---|
| `raisedSol` | SOL raised by the wallet's launches that aren't refunding (includes raises still open) |
| `depositedSol` / `refundedSol` | Gross deposits into raises / refunds received |
| `backerFeesEarnedSol` | Claimed + claimable backer earnings: fee share, vault profit share and wind-down payouts (= `deposited × accFeePerShare`, exactly as the program computes) |
| `creatorFeesEarnedSol` | Claimed + unclaimed creator fees of the wallet's launches |
| `trades`, `volumeSol`, … | Curve trades by the wallet (agent trades excluded) |
| `firstSeen` | Earliest indexed event, comment or launch of the wallet (`null` if never seen) |

`launches` is newest first; `backed` sorted by fees earned.

### `GET /api/users/:wallet/activity?before=&limit=`

Everything the wallet did (trades, deposits, refunds, claims, launches created) plus the launch-level `launched`/
`cancelled`/`profit_shared`/`wound_down` events of its launches, newest first. `limit` default 50, ≤ 200; `before`
unix seconds.

```json
{ "events": [ ActivityEvent, … ], "nextBefore": 1790425817 }
```

### `PUT /api/users/:wallet`

Creates or replaces the profile (fields left out or `null` are cleared). Body (JSON, ≤ 16 KB):

```json
{ "message": "holdfast:profile:v1\n<wallet>\n<sha256(profile) hex>\n1790498087",
  "signature": "<base58 signature by :wallet>",
  "profile": "{\"name\":\"bs_HQru7X\",\"bio\":\"testing holdfast social\",\"avatar\":\"http://…/files/img/Oe7_XRPbyQ_J.png\"}" }
```

`profile` is a **string** holding the JSON (the signature covers its exact bytes). Fields:

| Field | Rule |
|---|---|
| `name` | 2–24 chars of `A-Z a-z 0-9 _ . -`; unique case-insensitively |
| `bio` | ≤ 160 chars (trimmed, single line) |
| `avatar` | An image uploaded to this indexer (`POST /api/upload/image` → `image`, local or Arweave), or the `image` URL of any indexed launch |

`200` →

```json
{ "wallet": "HQru7X9aGHafTxr8S2NbNPiaei4RryhJiJgjoK13ATGS", "name": "bs_HQru7X", "bio": "testing holdfast social",
  "avatar": "http://127.0.0.1:8797/files/img/Oe7_XRPbyQ_J.png", "createdAt": 1790498087, "updatedAt": 1790498087 }
```

| Status | Error (examples) |
|---|---|
| `400` | `name must be 2-24 characters of A-Z a-z 0-9 _ . -`, `bio must be at most 160 characters`, `avatar must be an image uploaded to this indexer …`, `unknown profile field(s): twitter`, `profile must be a JSON object string`, `message is signed for <X>, not <wallet>` |
| `401` | `invalid signature`, timestamp outside ±300 s |
| `409` | `name is already taken`, `this signed message was already used; sign a new one` |
| `429` | per-IP signed-write limit, `too many profile updates (10/min)` |

---

## Discovery

### `GET /api/leaderboard`

| Query | Default | |
|---|---|---|
| `kind` | `traders` | `backers` \| `creators` \| `traders` \| `launches` |
| `window` | `24h` | `24h` \| `7d` \| `all` |
| `limit` | `25` | ≤ 100 |

Computed from indexed data and cached for 30 s per `kind`+`window` (`updatedAt` = computation time). Only rows with a
positive ranking metric are listed. `metric` names the field entries are ranked by (descending).

| kind | metric | Ranking |
|---|---|---|
| `backers` | `feesEarnedSol` | Backer fees earned. `all`: everything ever accrued to their deposits (claimed + claimable). `24h`/`7d`: their pro-rata share of the backer fees paid by trades inside the window |
| `creators` | `score` | `score = volumeSol + raisedSol`: SOL traded on their launches in the window + raises filled (launched) in the window |
| `traders` | `volumeSol` | SOL traded on the curve in the window (agent excluded) |
| `launches` | `volumeSol` | SOL traded in the window (live launches); `mcapChangePct` = price growth since the window start (last trade before it, else the launch price; `all` = since launch) |

```json
{ "kind": "backers", "window": "all", "metric": "feesEarnedSol", "updatedAt": 1790498025,
  "entries": [ { "rank": 1, "wallet": "Ckbc…", "name": null, "avatar": null,
    "feesEarnedSol": 0.000224286, "depositedSol": 0.05, "launchesBacked": 1 } ] }
```

Entry shapes per kind:

- `backers`: `rank, wallet, name, avatar, feesEarnedSol, depositedSol, launchesBacked`
- `creators`: `rank, wallet, name, avatar, score, volumeSol, raisedSol, creatorFeesSol` (fees earned in the window; `all` = claimed + unclaimed), `launches`, `liveLaunches`
- `traders`: `rank, wallet, name, avatar, volumeSol, trades, buys, sells, buyVolumeSol, sellVolumeSol, netSol, launchesTraded, lastTradeAt`
- `launches`: `rank, address, venue, mint, name, symbol, image, creator, creatorName, volumeSol, trades, traders, priceSol, marketCapSol, mcapChangePct (null if no reference price), holders`

`400` on an invalid `kind`/`window`/`limit`.

### `GET /api/search?q=`

`q`: 1–64 chars (required, `400` otherwise). Up to 8 launches and 8 users.

- Launches: case-insensitive substring of name or symbol, or (for `q` ≥ 3 base58 chars) a mint or launch address
  prefix (case-sensitive). Exact symbol/name/mint/address matches first, then prefixes, then substrings; newest first within a tier.
- Users: profile names starting with `q` (case-insensitive), and for `q` ≥ 3 base58 chars wallets starting with `q`
  (profiles, then any wallet seen on chain).

```json
{ "query": "VOLT",
  "launches": [ { "address": "62dt…", "venue": "holdfast", "mint": "DRoH…", "name": "Volt Runner", "symbol": "VOLT", "image": "https://…", "status": "live",
    "priceSol": 3.0099e-8, "marketCapSol": 30.099, "raised": "50000000", "holders": 1, "creatorName": null } ],
  "users": [ { "wallet": "FwYL…", "name": "holdfast_dev", "avatar": null } ] }
```

### `GET /api/trending`

King of the hill: the live launch with the most SOL volume in the last hour (ties → trades in the last hour, then
24 h volume, then market cap). `king` is `null` when no live launch traded in the last hour. `kingSince` is when it
took the top spot as observed by this indexer process (resets on restart). `top` is the 10 best live launches by the
same ranking.

```json
{ "updatedAt": 1790498030,
  "king": { "launch": LaunchSummary, "kingSince": 1790497000 },
  "top": [ LaunchSummary, … ] }
```

---

## Portfolio & activity

### `GET /api/portfolio/:wallet`

Live from chain (backer accounts + Token-2022 and SPL Token balances; three RPC calls). `holdings` matches token
balances to launches by mint, so it covers both venues.

```json
{ "backed": [ { "launch": LaunchSummary, "deposited": "50000000", "feesClaimed": "224286", "claimable": "0",
    "shareBps": 10000, "vaultShareSol": 0.01485, "vaultShareTokens": 1153667.514021, "refundable": false } ],
  "created": [ { "launch": LaunchSummary, "creatorFeesUnclaimed": "0", "creatorFeesClaimed": "134571" } ],
  "holdings": [ { "launch": LaunchSummary, "amount": "493371309053", "valueSol": 0.01485 } ] }
```

### `GET /api/activity?limit=`

Latest events across all launches, newest first. `limit` default 50, ≤ 500. → `{ "events": ActivityEvent[] }`

### `GET /api/agents`

Vault-agent overview: totals, per-live-launch window budgets and EMA band, 50 latest agent trades.

```json
{ "totals": { "buys": 0, "sells": 0, "solSpent": "0", "solReceived": "0" },
  "launches": [ { "address": "…", "venue": "holdfast", "mint": "…", "symbol": "VOLT", "name": "Volt Runner", "image": "…", "vaultSol": "14850000",
    "vaultTokens": "1153667514021", "windowStart": 1790425741, "windowBuyCap": "1485000", "windowSolSpent": "0",
    "windowSellCap": "57683375701", "windowTokensSold": "0", "priceSol": 3.0099e-8, "emaSol": 3.0069e-8,
    "bandLowSol": 2.9467e-8, "bandHighSol": 3.0670e-8, "agentBuys": 0, "agentSells": 0 } ],
  "recent": [ TradeRow & { "launch": "…", "venue": "holdfast", "mint": "…", "symbol": "VOLT" } ] }
```

---

## Uploads & files

### `POST /api/upload` (multipart/form-data)

Launch metadata for `create_launch`. Fields: `image` (file, required), `name` (≤ 32 bytes, required), `symbol`
(≤ 10 bytes, required), `description` (≤ 1000 chars), `twitter`, `telegram`, `website` (http(s) URL or handle),
`whitelist` (JSON array of base58 keys, ≤ 50 000). Images: PNG, JPEG, GIF, WebP or SVG (no scripts), ≤ 4 MB,
type sniffed from content.

→ `{ "uri": "https://…/files/meta/<id>.json", "image": "https://…/files/img/<id>.png" }` — put `uri` on chain. With
`STORAGE=arweave` both are Arweave data items instead: `{ "uri": "https://arweave.net/<id>", "image":
"https://arweave.net/<id>" }` (tagged `Content-Type`; gateways can take up to a minute to serve a fresh item).

### `POST /api/upload/image` (multipart/form-data)

Just an image (field `image`, same rules), e.g. a profile avatar. → `{ "image": "https://…/files/img/<id>.png" }`

Both uploads share the upload rate limit. `400` for a missing/invalid image or field, `413` above 4 MB, `503` when
`STORAGE=arweave` and the daily SOL budget (`ARWEAVE_DAILY_BUDGET_SOL`) is used up.

### `GET /files/img/<id>.<ext>`, `GET /files/meta/<id>.json`

Static, immutable (`Cache-Control: max-age=31536000, immutable`, `nosniff`; SVGs get a restrictive CSP).

## RPC proxy (`RPC_PROXY=1`)

### `POST /rpc`

Solana JSON-RPC (single call or batch of ≤ 20, body ≤ 64 KB) forwarded to `RPC_URL`; the upstream status and body
are relayed. Allowed: `getAccountInfo`, `getMultipleAccounts`, `getBalance`, `getTokenAccountBalance`,
`getLatestBlockhash`, `isBlockhashValid`, `getBlockHeight`, `getSlot`, `getSignatureStatuses`, `getTransaction`,
`getRecentPrioritizationFees`, `getFeeForMessage`, `getMinimumBalanceForRentExemption`, `simulateTransaction`,
`sendTransaction`, `requestAirdrop`, `getGenesisHash`, `getHealth`, `getEpochInfo`, `getVersion`. Any other method →
`{ "error": { "code": -32601 } }` for that call (the rest of a batch still runs). `429` over
`RPC_PROXY_LIMIT_PER_MIN` (every batch entry counts), `502` when the upstream is unreachable or slower than 15 s.

### `GET /rpc-ws`

Solana PubSub piped to `WS_URL` (one upstream socket per client; either side closing closes the other). Allowed:
`accountSubscribe`/`accountUnsubscribe`, `signatureSubscribe`/`signatureUnsubscribe`, `slotSubscribe`/`slotUnsubscribe`
and web3.js's `ping` notification; others → `-32601`. ≤ 10 connections per IP (more close with `1008`), ≤ 32
subscriptions per connection (`-32005`); every request counts against `RPC_PROXY_LIMIT_PER_MIN`.
