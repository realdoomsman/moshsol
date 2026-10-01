import { shortAddr } from "@holdfast/sdk";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ProfileView } from "@/components/profile/profile-view";
import { Hydrate, prefetch, serverQueryClient } from "@/lib/prefetch";
import { launchesQuery } from "@/lib/query-options";
import { parseMint } from "@/lib/server";
import { userActivityQuery, userQuery, usersApi, type UserProfile } from "@/lib/users";

type Params = { params: Promise<{ wallet: string }> };

/** Canonical base58 wallet, or null (the indexer 400s anything else). */
function parseWallet(raw: string): string | null {
  const key = parseMint(decodeURIComponent(raw));
  return key ? key.toBase58() : null;
}

/** Deduped per request so metadata and the page share one fetch. */
const loadUser = cache(async (wallet: string): Promise<UserProfile | null> => usersApi.user(wallet).catch(() => null));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const wallet = parseWallet((await params).wallet);
  if (!wallet) return { title: "Profile not found" };
  const user = await loadUser(wallet);
  const name = user?.name ?? shortAddr(wallet);
  const created = user?.stats.launchesCreated ?? 0;
  const description =
    user?.bio ??
    (user
      ? `${created} launch${created === 1 ? "" : "es"} created · ${user.stats.backedLaunches} backed on Holdfast.`
      : `Wallet ${wallet} on Holdfast.`);
  // No `openGraph` here: the share card inherits this title/description plus the root's site name.
  return { title: name, description, alternates: { canonical: `/u/${wallet}` } };
}

export default async function ProfilePage({ params, searchParams }: Params & { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const wallet = parseWallet((await params).wallet);
  if (!wallet) notFound();
  const startEditing = (await searchParams).edit === "1";

  const client = serverQueryClient();
  const user = await loadUser(wallet);
  if (user) client.setQueryData(userQuery(wallet).queryKey, user);
  await Promise.all([
    prefetch(client, userActivityQuery(wallet)),
    user?.launches.length ? prefetch(client, launchesQuery({ status: "all", sort: "trending" })) : null,
  ]);
  return (
    <Hydrate client={client}>
      <ProfileView wallet={wallet} startEditing={startEditing} />
    </Hydrate>
  );
}
