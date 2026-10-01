import type { Metadata } from "next";
import { A, B, C, P, Ul } from "@/components/docs/prose";
import { LEGAL_CONTACT, LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Holdfast stores about you: your Google account id and email if you sign in with Google, your custodial wallet's encrypted key, sessions and an audit log.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      intro={
        <>
          What Holdfast stores about you and why. Most of what you do here is a public Solana transaction that anyone can
          read on-chain; nobody, including us, can change or delete those.
        </>
      }
      sections={[
        {
          id: "google",
          title: "Sign in with Google",
          body: (
            <>
              <P>
                &ldquo;Continue with Google&rdquo; gives you a <B>custodial</B> Solana wallet: we create it and keep its key
                for you. When you sign in, Google tells us your Google account id, your email address and, through the{" "}
                <C>profile</C> scope, your name and profile picture. We store:
              </P>
              <Ul>
                <li>your Google account id and email address (we don&apos;t store your name or picture);</li>
                <li>
                  your wallet&apos;s address and its secret key, encrypted with AES-256-GCM under a key that only our account
                  service holds;
                </li>
                <li>
                  your sessions: a random id in an HttpOnly cookie, kept on our server until you sign out or for at most 7
                  days;
                </li>
                <li>
                  an audit log of sign-ups, sign-ins, sign-outs, transactions signed (a hash of each), transactions refused
                  (the reason) and key exports, each with your account, the time and your IP address. Keys are never
                  logged.
                </li>
              </Ul>
              <P>
                We sign with your key only for transactions you start on this site that pass our signing rules (you pay
                the fee; only the Holdfast program, System, Compute Budget, token and memo programs). You can withdraw
                your SOL and tokens, or export the key, at any time from the wallet menu. Exporting needs a Google
                sign-in from the last 10 minutes and shows the key once per sign-in; whoever has the key controls the
                wallet.
              </P>
            </>
          ),
        },
        {
          id: "other",
          title: "Everything else",
          body: (
            <Ul>
              <li>
                <B>Public chain data.</B> Launches, deposits, trades, holders and wallet addresses are read from Solana
                and shown to everyone.
              </li>
              <li>
                <B>Comments and profiles</B> you sign with a wallet are public, and so are token images and metadata
                (stored permanently on Arweave).
              </li>
              <li>
                <B>IP addresses</B> are counted in memory for about a minute to rate-limit requests and appear in our
                server logs when a limit is hit; apart from that only the audit log above keeps them.
              </li>
              <li>
                <B>Your browser</B> keeps your chosen wallet, watchlist, trade settings and create-form draft in local
                storage; on test networks also the test wallet&apos;s key.
              </li>
              <li>
                <B>Providers.</B> The site runs on Railway; Solana RPC providers see the reads and transactions sent
                through them. No analytics, no ads, and we don&apos;t sell or share your data.
              </li>
            </Ul>
          ),
        },
        {
          id: "retention",
          title: "Keeping and deleting",
          body: (
            <>
              <P>
                We keep your account and encrypted key for as long as the wallet may hold funds. To delete your account,
                withdraw your funds or export your key first, then email <A href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</A>{" "}
                from the Google address you sign in with. We then delete your email, sessions and encrypted key — after
                that nobody can recover the wallet unless you exported its key — and your audit entries, unless we need
                them to investigate abuse. On-chain records can&apos;t be deleted.
              </P>
              <P>
                If our servers, our encryption key or the account database were lost or stolen, funds in Google wallets
                could be lost or taken: keep only what you are prepared to lose in one. See the <A href="/terms">terms</A>.
              </P>
            </>
          ),
        },
        {
          id: "contact",
          title: "Contact",
          body: (
            <P>
              Questions or requests about your data: <A href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</A>.
            </P>
          ),
        },
      ]}
    />
  );
}
