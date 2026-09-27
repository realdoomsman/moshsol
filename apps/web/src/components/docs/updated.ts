import { execFileSync } from "node:child_process";
import { join } from "node:path";

const cache = new Map<string, string | null>();

/**
 * "Last updated" for a docs page (§4.11): the last git commit touching its content file in
 * `components/docs/pages`, as an ISO date. Null where git or the history isn't available (e.g. a
 * container build without `.git`); the page then shows no date rather than a made-up one.
 */
export function docUpdated(file: string): string | null {
  if (cache.has(file)) return cache.get(file) ?? null;
  let value: string | null = null;
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", join(process.cwd(), "src", "components", "docs", "pages", file)], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    value = out || null;
  } catch {
    value = null;
  }
  cache.set(file, value);
  return value;
}
