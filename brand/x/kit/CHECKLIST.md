# Posting checklist — new Holdfast account

Copy for every step is in `brand/x/README.md` (the fenced block under each heading, verbatim). Lengths are checked by `node brand/x/kit/lengths.mjs`. Nothing here is posted automatically.

## 0. Before anything

- [ ] Re-render and eyeball the images: `node brand/x/src/cards.mjs --render`, then look at each `brand/x/card-*.png` at phone size (`brand/x/kit/review/*-600.png` is the last review set). One idea per card, nothing clipped, nothing touching the footer.
- [ ] Confirm the three videos exist with sound: `brand/x/video/final/holdfast-explainer.mp4`, `the-bundle.mp4`, `vault-agent.mp4` (each has a `.srt` alongside; upload it as captions where X allows).
- [ ] Scan everything for forbidden content: no other coins or projects, no token/launch/tx addresses, no test launch names, no "$" tickers, no emojis, no hashtags, no price promises. Only the program id, the admin multisig and holdfast.fun links.

## 1. Profile

| Field | Value |
|---|---|
| Avatar | `brand/x/kit/avatar.png` (1000×1000) |
| Header | `brand/x/kit/banner.png` (3000×1000) |
| Name | `Holdfast` |
| Bio | README → "Bio (160 max)" block |
| Location | `Solana` |
| Website | `https://holdfast.fun` |

- [ ] Check the header on a phone: the avatar must not cover "Backers buy first."

## 2. The article (first, before any post)

- [ ] X Articles → new. Title `How Holdfast works`. Subtitle: the italic line under the title in `brand/x/article-how-holdfast-works.md`.
- [ ] Cover image: `brand/x/cover.png`.
- [ ] Paste the article body (everything after the subtitle). Keep the tables; keep code formatting on instruction names.
- [ ] Replace each `[image: file — caption]` slot with that image from `brand/x/` and the caption as its alt text. Delete the `[cover: …]` line (the cover is set above).
- [ ] Publish, copy the article URL.

## 3. Pinned post

- [ ] New post: README → PINNED block. Attach `brand/x/video/final/holdfast-explainer.mp4` (captions: the `.srt`). Quote the article URL (paste it as a quote, not as a plain link: a quoted link doesn't count toward 280).
- [ ] Post, then **Pin to profile**.

## 4. Posts, in this order, one at a time

Space them out (hours or days apart, not minutes). No replies, no threads. Each row: copy = README block of that id, media = one file.

| Order | Id | Media | Note |
|---|---|---|---|
| 1 | P1 | `brand/x/card-how.png` | the overview |
| 2 | P2 | `brand/x/card-bundle.png` | the bundle |
| 3 | V1 | `brand/x/video/final/the-bundle.mp4` + `.srt` | video of the same |
| 4 | P3 | `brand/x/card-vault.png` | the vault agent |
| 5 | V2 | `brand/x/video/final/vault-agent.mp4` + `.srt` | video of the same |
| 6 | P4 | `brand/x/card-agent-rules.png` | the rules |
| 7 | P5 | `brand/x/card-money.png` | the money |
| 8 | P6 | `brand/x/card-payback.png` | payback |
| 9 | P7 | `brand/x/card-not.png` | what it doesn't do |
| 10 | P8 | `brand/x/card-check.png` | check it yourself |

For each post:
- [ ] Paste the block exactly (line breaks included).
- [ ] Attach the one media file; add alt text = the card's headline.
- [ ] Preview on a phone before sending.

## 5. After posting

- [ ] Record the post ids at the bottom of `brand/x/README.md` (date, id per post) so the next kit knows what is live.
- [ ] Don't delete and repost to fix typos on the pinned post; edit if the account has edit, otherwise leave it.
