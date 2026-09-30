import { setTimeout as sleep } from "node:timers/promises";
import {
  defaultPaymentServiceURL,
  defaultUploadServiceURL,
  developmentPaymentServiceURL,
  developmentUploadServiceURL,
  FailedRequestError,
  TurboFactory,
  type TurboAuthenticatedClient,
} from "@ardrive/turbo-sdk";
import { utils } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, type Keypair } from "@solana/web3.js";
import type { FastifyBaseLogger } from "fastify";
import type { Store } from "./db";
import { HttpError, isRecord } from "./sanitize";

/**
 * `mainnet`: Turbo's production services; data is permanent on Arweave.
 * `dev`: the ar.io testnet sandbox, paid with devnet SOL; data is ephemeral and served by ar-io.dev only.
 */
const NETWORKS = {
  mainnet: { gateway: "https://arweave.net", upload: defaultUploadServiceURL, payment: defaultPaymentServiceURL },
  dev: { gateway: "https://ar-io.dev", upload: developmentUploadServiceURL, payment: developmentPaymentServiceURL },
} as const;

/** Upper bound of the ANS-104 envelope (signature, owner, tags) the SDK wraps around each payload. */
const DATA_ITEM_OVERHEAD = 1024;
/** Top up 10% above the quoted deficit (Turbo's own on-demand default) so price drift can't strand an upload. */
const TOP_UP_BUFFER_PCT = 110n;
/** Base fee of the SOL transfer, counted against the daily budget together with the transfer amount. */
const TRANSFER_FEE_LAMPORTS = 5_000;
const UPLOAD_TIMEOUT_MS = 60_000;
/** How long to wait for a confirmed top-up to show up as credits before failing the request. */
const CREDIT_WAIT_MS = 60_000;
const CREDIT_POLL_MS = 2_000;
/** Data-item ids are 43-char base64url; sizes the metadata JSON before the image id exists. */
const ID_PLACEHOLDER = "x".repeat(43);

export interface ArweaveOptions {
  keypair: Keypair;
  network: keyof typeof NETWORKS;
  /** Solana RPC the SOL top-up transfers are sent through. */
  rpcUrl: string;
  /** Hard cap on SOL (lamports) sent to Turbo per UTC day, persisted in the DB. */
  dailyBudgetLamports: number;
}

/**
 * Uploads to Arweave through ArDrive Turbo, paying with SOL from a server key. Items within Turbo's free tier
 * cost nothing; otherwise credits are bought lazily: only when the quoted cost exceeds the Turbo balance, for the
 * deficit plus a 10% buffer, and never past the daily budget. Uploads run one at a time so concurrent requests
 * can't double-fund.
 */
export class ArweaveStore {
  readonly gateway: string;
  readonly address: string;
  private readonly turbo: TurboAuthenticatedClient;
  private readonly uploadUrl: string;
  private queue: Promise<unknown> = Promise.resolve();
  private freeItemBytes: Promise<number> | null = null;

  constructor(
    private readonly opts: ArweaveOptions,
    private readonly store: Store,
    private readonly log: FastifyBaseLogger,
  ) {
    const network = NETWORKS[opts.network];
    // The SDK logs plain-text lines to the console; failures reach us as thrown errors and get logged here.
    TurboFactory.setLogLevel("none");
    this.turbo = TurboFactory.authenticated({
      privateKey: utils.bytes.bs58.encode(opts.keypair.secretKey),
      token: "solana",
      gatewayUrl: opts.rpcUrl,
      uploadServiceConfig: { url: network.upload },
      paymentServiceConfig: { url: network.payment },
    });
    this.gateway = network.gateway;
    this.uploadUrl = network.upload;
    this.address = opts.keypair.publicKey.toBase58();
  }

  /** Stores one image; returns its gateway URL. */
  uploadImage(image: Buffer, contentType: string): Promise<string> {
    return this.serialized(async () => {
      await this.ensureCredits([image.length], true);
      return this.putImage(image, contentType);
    });
  }

  /** Stores an image, then the metadata JSON `metadataFor(imageUrl)` builds around its URL. */
  uploadLaunch(image: Buffer, contentType: string, metadataFor: (imageUrl: string) => object): Promise<{ uri: string; image: string }> {
    return this.serialized(async () => {
      const metaBytes = Buffer.byteLength(JSON.stringify(metadataFor(`${this.gateway}/${ID_PLACEHOLDER}`)));
      await this.ensureCredits([image.length, metaBytes], true);
      const imageUrl = await this.putImage(image, contentType);
      const uri = await this.put(Buffer.from(JSON.stringify(metadataFor(imageUrl))), "application/json");
      return { uri, image: imageUrl };
    });
  }

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Largest data item Turbo uploads for free (0 when the deployment has no free tier). */
  private async fetchFreeItemBytes(): Promise<number> {
    const res = await fetch(`${this.uploadUrl}/v1/info`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Turbo upload service info returned HTTP ${res.status}`);
    const info: unknown = await res.json();
    const limit = isRecord(info) ? info.freeUploadLimitBytes : undefined;
    return typeof limit === "number" ? limit : 0;
  }

  /**
   * Buys enough credits for items of these payload sizes, within the daily budget (503 when exhausted).
   * With `useFreeTier`, items the wallet's free allowance should cover are left out of the quote.
   */
  private async ensureCredits(payloadBytes: number[], useFreeTier: boolean): Promise<void> {
    let items = payloadBytes.map((b) => b + DATA_ITEM_OVERHEAD);
    if (useFreeTier) {
      this.freeItemBytes ??= this.fetchFreeItemBytes().catch((err: unknown) => {
        this.freeItemBytes = null;
        throw err;
      });
      const [maxFree, { bytesRemaining }] = await Promise.all([this.freeItemBytes, this.turbo.getFreeStatus()]);
      let freeLeft = bytesRemaining ?? Number.POSITIVE_INFINITY;
      items = items.filter((bytes) => {
        if (bytes > maxFree || bytes > freeLeft) return true;
        freeLeft -= bytes;
        return false;
      });
      if (items.length === 0) return;
    }

    const quotes = await this.turbo.getUploadCosts({ bytes: items });
    const need = quotes.reduce((sum, q) => sum + BigInt(q.winc), 0n);
    const balance = BigInt((await this.turbo.getBalance()).effectiveBalance);
    if (balance >= need) return;

    const deficit = ((need - balance) * TOP_UP_BUFFER_PCT + 99n) / 100n;
    const wincPerSol = BigInt((await this.turbo.getWincForToken({ tokenAmount: LAMPORTS_PER_SOL })).winc);
    const lamports = Number((deficit * BigInt(LAMPORTS_PER_SOL) + wincPerSol - 1n) / wincPerSol);
    const day = new Date().toISOString().slice(0, 10);
    const budget = this.opts.dailyBudgetLamports;
    // Reserved before sending and never released: a crash mid-transfer can't make the budget forget SOL that left.
    if (!this.store.reserveUploadSpend(day, lamports + TRANSFER_FEE_LAMPORTS, budget)) {
      this.log.warn(
        { day, spentLamports: this.store.uploadSpend(day), neededLamports: lamports, budgetLamports: budget },
        "arweave daily budget exhausted",
      );
      throw new HttpError(503, "Upload budget for today is used up; uploads resume after 00:00 UTC");
    }
    this.log.info({ lamports, needWinc: String(need), balanceWinc: String(balance), day }, "funding turbo credits");
    const fund = await this.turbo.topUpWithTokens({ tokenAmount: lamports });
    this.log.info({ tx: fund.id, status: fund.status, winc: fund.winc }, "turbo credits funded");

    const deadline = Date.now() + CREDIT_WAIT_MS;
    while (BigInt((await this.turbo.getBalance()).effectiveBalance) < need) {
      if (Date.now() > deadline) throw new HttpError(503, "Upload payment is still confirming; retry in a minute");
      await sleep(CREDIT_POLL_MS);
    }
  }

  /** Uploads an image and records it as ours (avatars may only point at images uploaded here). */
  private async putImage(image: Buffer, contentType: string): Promise<string> {
    const url = await this.put(image, contentType);
    this.store.addUploadedImage(url, Math.floor(Date.now() / 1000));
    return url;
  }

  private async put(data: Buffer, contentType: string): Promise<string> {
    const upload = () =>
      this.turbo.upload({
        data,
        dataItemOpts: { tags: [{ name: "Content-Type", value: contentType }] },
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    try {
      return `${this.gateway}/${(await upload()).id}`;
    } catch (err) {
      if (!(err instanceof FailedRequestError && err.status === 402)) throw err;
      // The free tier turned it down after all (its checks are advisory, e.g. a per-IP cap): pay for it and retry once.
      this.log.info({ bytes: data.length }, "free tier declined upload; paying for it");
      await this.ensureCredits([data.length], false);
      return `${this.gateway}/${(await upload()).id}`;
    }
  }
}
