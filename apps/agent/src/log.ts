/** One structured JSON line per event on stdout (bigints rendered as decimal strings). */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields }, (_, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  console.log(line);
}
