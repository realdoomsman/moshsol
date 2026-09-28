"use client";

import { ArrowUpDown } from "lucide-react";
import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

const FIELD =
  "rounded-sm border border-line-2 bg-field text-ink transition-colors placeholder:text-ink-3 " +
  "hover:border-ink-3 aria-invalid:border-down disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  size?: "md" | "lg";
  /** Marks the field invalid (red border + aria-invalid). Show the message with `<Field error>`. */
  invalid?: boolean;
  /** Inline adornments inside the border, e.g. a `$` prefix or a unit suffix. */
  prefix?: ReactNode;
  suffix?: ReactNode;
}

/** Text input, 40px (md) or 48px (lg), 8px radius. Use inside `<Field>` for a label. */
export function Input({ size = "md", invalid, prefix, suffix, className, ...rest }: InputProps) {
  const input = (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full min-w-0 text-[15px] placeholder:text-ink-3",
        prefix || suffix ? "bg-transparent outline-none" : cn(FIELD, "px-3", size === "lg" ? "h-12" : "h-10", className),
      )}
      {...rest}
    />
  );
  if (!prefix && !suffix) return input;
  return (
    <div
      aria-invalid={invalid || undefined}
      className={cn(
        FIELD,
        "flex items-center gap-2 px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
        size === "lg" ? "h-12" : "h-10",
        className,
      )}
    >
      {prefix ? <span className="shrink-0 text-ink-3">{prefix}</span> : null}
      {input}
      {suffix ? <span className="shrink-0 text-ink-3">{suffix}</span> : null}
    </div>
  );
}

export function Textarea({
  invalid,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(FIELD, "min-h-24 w-full resize-y px-3 py-2 text-[15px] leading-6", className)}
      {...rest}
    />
  );
}

/**
 * Label (11px `label` style) + control + one line of help or error. The control receives `id` via
 * the render prop so the label is wired up: `<Field label="Ticker">{(id) => <Input id={id} />}</Field>`.
 */
export function Field({
  label,
  hint,
  error,
  aside,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Right side of the label row (e.g. "Balance 1.24 SOL"). */
  aside?: ReactNode;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label text-ink-3">
          {label}
        </label>
        {aside ? <span className="small num text-ink-3">{aside}</span> : null}
      </div>
      {children(id)}
      {error ? (
        <p role="alert" className="small text-down">
          {error}
        </p>
      ) : hint ? (
        <p className="small text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

/** Keep digits and one decimal point, capped to `decimals` places ("0.50" stays "0.50" while typing). */
function sanitizeAmount(raw: string, decimals: number): string {
  let s = raw.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "").slice(0, decimals);
  if (/^0\d/.test(s)) s = s.replace(/^0+(?=\d)/, "");
  return s;
}

export interface AmountPreset {
  label: string;
  /** Called when the chip is pressed; set the amount from it. */
  onSelect: () => void;
  active?: boolean;
}

/**
 * Big tabular amount entry for trade/back panels (§4.5): `num-l` digits, a unit button that can
 * toggle (SOL ⇅ token), a balance line with Max, and optional preset chips.
 */
export function AmountInput({
  value,
  onChange,
  unit,
  onToggleUnit,
  decimals = 9,
  balance,
  onMax,
  presets,
  invalid,
  label = "Amount",
  placeholder = "0.00",
  disabled,
  id,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Unit label, e.g. "SOL" or "$MOSH". */
  unit: string;
  /** Makes the unit a toggle (SOL ⇅ token). */
  onToggleUnit?: () => void;
  decimals?: number;
  /** Pre-formatted balance, e.g. "1.24 SOL". */
  balance?: string;
  onMax?: () => void;
  presets?: AmountPreset[];
  invalid?: boolean;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className="label text-ink-3">
          {label}
        </label>
        {balance ? (
          <span className="small num flex items-center gap-2 text-ink-3">
            Balance {balance}
            {onMax ? (
              <button
                type="button"
                onClick={onMax}
                disabled={disabled}
                className="relative [font-weight:560] text-ink underline decoration-ink-3/60 underline-offset-2 transition-colors before:absolute before:-inset-2 hover:decoration-ink"
              >
                Max
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div
        aria-invalid={invalid || undefined}
        className={cn(
          FIELD,
          "flex h-14 items-center gap-2 pr-2 pl-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
          disabled && "bg-sunken",
        )}
      >
        <input
          id={inputId}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(sanitizeAmount(e.target.value, decimals))}
          className="num-l w-full min-w-0 bg-transparent outline-none placeholder:text-ink-3"
        />
        {onToggleUnit ? (
          <button
            type="button"
            onClick={onToggleUnit}
            disabled={disabled}
            aria-label={`Amount in ${unit}; switch unit`}
            className="ui flex h-10 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-ink-2 transition-colors hover:bg-raised hover:text-ink"
          >
            {unit}
            <ArrowUpDown className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        ) : (
          <span className="ui shrink-0 px-2.5 text-ink-2">{unit}</span>
        )}
      </div>
      {presets?.length ? (
        <div className="grid auto-cols-fr grid-flow-col gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={disabled}
              aria-pressed={p.active}
              onClick={p.onSelect}
              className={cn(
                "small num h-8 rounded-sm border px-2 [font-weight:560] transition-colors pointer-coarse:h-10",
                p.active ? "border-ink bg-ink text-paper" : "border-line-2 text-ink-2 hover:border-ink-3 hover:bg-raised hover:text-ink",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
