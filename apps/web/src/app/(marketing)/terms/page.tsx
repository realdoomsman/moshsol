import type { Metadata } from "next";
import { A, B, C, P, Ul } from "@/components/docs/prose";
import { LEGAL_CONTACT, LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms of use for Holdfast: custodial Google wallets and their risks, the platform multisig's power over vault funds, no warranty.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      intro={<>By using Holdfast you agree to these terms. If you don&apos;t, don&apos;t use the site.</>}
      sections={[
        {
          id: "service",
          title: "What Holdfast is",
          body: (
            <>
              <P>
                Holdfast is a website and API in front of a Solana program: people raise SOL for a token, launch it on
                pump.fun (or, for legacy launches, the Holdfast bonding curve), and a vault agent trades each launch&apos;s vault under on-chain rules. We are not a broker,
                exchange or adviser, and nothing here is investment advice.
              </P>
              <P>
                Memecoins are extremely speculative. Most lose most of their value, prices can move to zero in minutes, and
                you can lose everything you put in. Transactions on Solana are final.
              </P>
            </>
          ),
        },
        {
          id: "google-wallets",
          title: "Google wallets are custodial",
          body: (
            <>
              <P>
                If you sign in with Google, we create a Solana wallet for you and hold its key, encrypted, on our servers.
                We sign with it only for transactions you start on this site that pass our signing rules, and you can
                withdraw your SOL and tokens or export the key at any time from the wallet menu.
              </P>
              <Ul>
                <li>
                  If our servers or our encryption key were compromised, or the key or the account database were lost,
                  the funds in Google wallets could be stolen or become unreachable. Keep only what you can afford to
                  lose in one, and move larger amounts to a wallet you control.
                </li>
                <li>
                  Whoever controls your Google account controls your Holdfast wallet, including exporting its key. Keep
                  your Google account secure.
                </li>
                <li>
                  An exported key gives full control of the wallet to anyone who sees it. We will never ask you for it.
                </li>
              </Ul>
            </>
          ),
        },
        {
          id: "vaults",
          title: "Vault funds, the platform multisig and the dev key",
          body: (
            <>
              <P>
                Each launch&apos;s vault (the SOL and tokens its bundle and agent hold) is controlled by the program, and the
                program gives two parties <B>the power to withdraw vault SOL and tokens</B> at any time: the platform admin — a
                2-of-3 Squads multisig — to the platform&apos;s fee recipient (<C>admin_withdraw_vault</C>), and a single dev key
                set by that admin, to the dev key&apos;s own wallet (<C>dev_withdraw_vault</C>, which works even while the platform is
                paused). Every withdrawal is a public on-chain event shown on the launch page. Don&apos;t rely on vault funds
                staying in a vault, on the vault agent ever buying, or on the vault ever paying backers back.
              </P>
              <P>
                The same multisig can upgrade the program and change platform parameters (live launches keep the terms
                they were created with). See <A href="/docs/risks">Risks</A> for the full list.
              </P>
            </>
          ),
        },
        {
          id: "use",
          title: "Your responsibilities",
          body: (
            <Ul>
              <li>Use Holdfast only where it is legal for you to do so, and follow the laws that apply to you.</li>
              <li>Don&apos;t manipulate markets, impersonate others, launch tokens that infringe rights, or attack the site.</li>
              <li>
                Creators are responsible for their token&apos;s name, image, links and claims. We may hide content or
                comments from the site; on-chain data stays on-chain.
              </li>
            </Ul>
          ),
        },
        {
          id: "warranty",
          title: "No warranty",
          body: (
            <P>
              Holdfast is provided as is. The program, the site and the account service may have bugs, and Solana or our
              providers may be unavailable. To the extent the law allows, we are not liable for losses from using
              Holdfast, including lost funds, failed or mistaken transactions and token prices. We may change these terms;
              the date at the top changes with them.
            </P>
          ),
        },
        {
          id: "contact",
          title: "Contact",
          body: (
            <P>
              <A href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</A>. How we handle your data: <A href="/privacy">privacy</A>.
            </P>
          ),
        },
      ]}
    />
  );
}
