import type { ReactNode } from "react";
import { cn } from "../ui/cn";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  counter,
  optional,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  counter?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted">
          {label}
          {optional ? <span className="ml-1.5 text-xs font-normal text-dim">optional</span> : null}
        </label>
        {counter ? <span className="text-[11px] tabular-nums text-dim">{counter}</span> : null}
      </div>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-down" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-dim">{hint}</p>
      ) : null}
    </div>
  );
}

export function Section({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-white/[0.04] text-xs font-bold text-lime tabular-nums">
          {step}
        </span>
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Numeric text input with a unit suffix. */
export function AmountInput({
  id,
  value,
  onChange,
  unit,
  placeholder,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const v = e.target.value.replace(",", ".");
          if (/^\d*\.?\d{0,9}$/.test(v)) onChange(v);
        }}
        className="field pr-14 tabular-nums"
      />
      <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-xs font-semibold text-dim">
        {unit}
      </span>
    </div>
  );
}
