import { log } from "./log";

/** An OpenAI-compatible chat-completions endpoint used only to put decisions into words; it never decides trades. */
export interface NarratorConfig {
  /** Base URL (`https://host/openai`, `https://host/v1`) or the full `/chat/completions` URL. */
  url: string;
  key: string;
  model: string;
  /** Tried once when `model` still answers 503 after the retries. */
  fallbackModel?: string;
}

/** `AI_API_URL` + `AI_API_KEY` + `AI_MODEL` (+ optional `AI_MODEL_FALLBACK`); null unless all three are set (narration is off). */
export function loadNarratorConfig(env: NodeJS.ProcessEnv = process.env): NarratorConfig | null {
  const url = env.AI_API_URL?.trim();
  const key = env.AI_API_KEY?.trim();
  const model = env.AI_MODEL?.trim();
  if (!url || !key || !model) return null;
  const fallbackModel = env.AI_MODEL_FALLBACK?.trim();
  return fallbackModel ? { url, key, model, fallbackModel } : { url, key, model };
}

const COMPLETIONS_PATH = "/chat/completions";
/** Waits before the 2nd and 3rd attempt after a 429/503. */
const RETRY_DELAYS_MS = [1_000, 3_000];
/** Everything (attempts, waits, the fallback) fits into this window. */
const BUDGET_MS = 20_000;
/** One request; two of them (primary, then fallback) fit into the budget with the first retry wait. */
const ATTEMPT_TIMEOUT_MS = 8_000;

type Attempt = { text: string } | { status: number } | { error: string };

export class Narrator {
  private readonly endpoint: string;
  private readonly retryDelaysMs: number[];
  private readonly budgetMs: number;

  constructor(
    private readonly cfg: NarratorConfig,
    opts: { retryDelaysMs?: number[]; budgetMs?: number } = {},
  ) {
    const base = cfg.url.replace(/\/+$/, "");
    this.endpoint = base.endsWith(COMPLETIONS_PATH) ? base : base + COMPLETIONS_PATH;
    this.retryDelaysMs = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
    this.budgetMs = opts.budgetMs ?? BUDGET_MS;
  }

  /**
   * Trimmed assistant text, or null on any failure (HTTP error, timeout, malformed body). 429/503 are retried
   * with backoff, and a 429/503 or a timeout that outlives the retries goes to `fallbackModel` once (its quota
   * and capacity are separate); all of it stays inside a ~20 s budget. Never throws and never logs the key: a
   * dead narrator must not disturb the agent.
   */
  async narrate(system: string, user: string, opts: { maxSentences?: number; timeoutMs?: number } = {}): Promise<string | null> {
    const deadline = Date.now() + this.budgetMs;
    const timeoutMs = opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
    const messages = [
      {
        role: "system",
        content: `${system} The trading decisions are made by fixed rules and are final; you only describe them. Reply in at most ${opts.maxSentences ?? 2} sentences.`,
      },
      { role: "user", content: user },
    ];
    const request = (model: string) => this.request(model, messages, Math.min(timeoutMs, deadline - Date.now()));

    let last: Attempt = await request(this.cfg.model);
    for (let i = 0; "status" in last && (last.status === 429 || last.status === 503) && i < this.retryDelaysMs.length; i++) {
      const delay = this.retryDelaysMs[i];
      if (Date.now() + delay >= deadline) break;
      await new Promise((r) => setTimeout(r, delay));
      last = await request(this.cfg.model);
    }
    const unavailable = ("status" in last && (last.status === 429 || last.status === 503)) || ("error" in last && last.error === "timeout");
    if (unavailable && this.cfg.fallbackModel && Date.now() < deadline) {
      last = await request(this.cfg.fallbackModel);
    }
    if ("text" in last) return last.text;
    log("narration_failed", { error: "status" in last ? `HTTP ${last.status}` : last.error });
    return null;
  }

  private async request(model: string, messages: { role: string; content: string }[], timeoutMs: number): Promise<Attempt> {
    if (timeoutMs <= 0) return { error: "narration budget exhausted" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.key}` },
        signal: controller.signal,
        // Reasoning models count their hidden thinking against max_tokens: leave room so 2–3 sentences never truncate.
        body: JSON.stringify({ model, temperature: 0.3, max_tokens: 400, messages }),
      });
      if (!res.ok) return { status: res.status };
      const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") return { error: "no content in response" };
      const text = content.trim();
      return text.length ? { text } : { error: "empty completion" };
    } catch (e) {
      if (controller.signal.aborted) return { error: "timeout" };
      return { error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }
}
