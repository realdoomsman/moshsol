import { proxyToAccounts } from "@/lib/accounts-proxy";

/** Google sign-in, session and sign-out: proxied to the accounts service (lib/accounts-proxy.ts). */
export { proxyToAccounts as GET, proxyToAccounts as POST };
