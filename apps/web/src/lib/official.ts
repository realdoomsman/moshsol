import { BUYBACK_MINT_UNSET } from "./pump-terms";

/**
 * The official Holdfast token: the mint `buyback_burn` buys and burns (`platform.buyback_mint`), or null
 * while it is the default pubkey (no token yet). Every "official" pin, badge and panel derives from this.
 */
export function officialMintOf(params: { buybackMint: string } | null | undefined): string | null {
  const mint = params?.buybackMint;
  return mint && mint !== BUYBACK_MINT_UNSET ? mint : null;
}

/** `list` with the official token moved to the front (order otherwise kept); unchanged when it isn't in it. */
export function pinOfficial<T extends { mint: string }>(list: T[], mint: string | null): T[] {
  if (!mint) return list;
  const i = list.findIndex((l) => l.mint === mint);
  return i <= 0 ? list : [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}
