import Link from "next/link";
import type { ReactNode } from "react";
import { CopyButton } from "../ui/address";
import { cn } from "../ui/cn";

/**
 * Docs typography (§4.11): `body` 15/24 in `ink-2` held to a ~66ch measure, `h3` subheads, code in
 * JetBrains Mono 13px on `surface` panels with a copy button, callouts with a 2px left rule
 * (ink-2 / warn / accent). Server components.
 */

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("body mt-4 max-w-[66ch] text-ink-2 first:mt-0", className)}>{children}</p>;
}

export function H3({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="h3 mt-8 text-ink first:mt-0">
      {children}
    </h3>
  );
}

export function Ul({ children }: { children: ReactNode }) {
  return <ul className="body mt-4 grid max-w-[66ch] list-disc gap-2 pl-5 text-ink-2 marker:text-ink-3">{children}</ul>;
}

export function Ol({ children }: { children: ReactNode }) {
  return <ol className="body mt-4 grid max-w-[66ch] list-decimal gap-2 pl-5 text-ink-2 marker:text-ink-3">{children}</ol>;
}

/** Strong term inside running text. */
export function B({ children }: { children: ReactNode }) {
  return <strong className="font-[560] text-ink">{children}</strong>;
}

/** Inline code / account / instruction name. */
export function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-xs bg-raised px-1.5 py-px font-mono text-[13px] text-ink ring-1 ring-line ring-inset">{children}</code>
  );
}

/** Internal or external link in prose. */
export function A({ href, children }: { href: string; children: ReactNode }) {
  const cls = "rounded-xs text-ink underline decoration-ink-3/60 underline-offset-4 transition-colors hover:decoration-ink";
  return href.startsWith("http") ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children} ↗
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Callout({ tone = "ink", title, children }: { tone?: "ink" | "warn" | "accent"; title?: string; children: ReactNode }) {
  return (
    <aside
      className={cn(
        "mt-6 max-w-[66ch] rounded-r-sm border border-l-2 border-line bg-surface px-4 py-3",
        tone === "ink" ? "border-l-ink-2" : tone === "warn" ? "border-l-warn" : "border-l-accent",
      )}
    >
      {title ? <p className={cn("ui", tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent-ink" : "text-ink")}>{title}</p> : null}
      <div className={cn("body text-ink-2", title && "mt-1")}>{children}</div>
    </aside>
  );
}

export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex h-9 items-center justify-between border-b border-line pr-2 pl-4">
        <span className="label text-ink-3">{label ?? "Code"}</span>
        <CopyButton value={children} label="Copy code" />
      </div>
      {/* Focusable so keyboard users can scroll long lines sideways (WCAG 2.1.1). */}
      <pre
        tabIndex={0}
        role="region"
        aria-label={label ?? "Code"}
        className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-[21px] text-ink focus-visible:outline-offset-[-2px]"
      >
        <code>{children}</code>
      </pre>
    </div>
  );
}

/** A two-or-more column reference table with 1px rules; scrolls sideways (and takes focus to) on narrow screens. */
export function Table({ head, rows, className }: { head: ReactNode[]; rows: ReactNode[][]; className?: string }) {
  return (
    <div tabIndex={0} role="region" aria-label="Scrollable table" className={cn("mt-4 overflow-x-auto", className)}>
      <table className="w-full min-w-[480px] border-collapse">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="label border-b border-line py-2 pr-4 text-left font-[inherit] text-ink-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="small text-ink-2">
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top">
              {r.map((c, j) => (
                <td key={j} className={cn("py-2.5 pr-4", j === 0 && "text-ink")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Embedded live component with a caption, set off from the prose. */
export function Figure({ children, caption }: { children: ReactNode; caption?: ReactNode }) {
  return (
    <figure className="mt-6">
      {children}
      {caption ? <figcaption className="micro mt-2 text-ink-3">{caption}</figcaption> : null}
    </figure>
  );
}
