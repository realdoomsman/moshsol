import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "buy" | "sell" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * On the dark ground, hover lifts: filled buttons mix 10% toward white (ink dims 10% toward the
 * ground instead), outlined ones step up to `raised` with a brighter rule. 100 ms, house easing.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-[color-mix(in_oklab,var(--color-ink),var(--color-paper)_12%)]",
  accent: "bg-accent text-on-accent hover:bg-[color-mix(in_oklab,var(--color-accent),white_10%)]",
  secondary: "border border-line-2 bg-surface text-ink hover:border-ink-3 hover:bg-raised",
  ghost: "text-ink-2 hover:bg-raised hover:text-ink",
  buy: "bg-up text-on-up hover:bg-[color-mix(in_oklab,var(--color-up),white_10%)]",
  sell: "bg-down text-on-down hover:bg-[color-mix(in_oklab,var(--color-down),white_10%)]",
  danger: "border border-down text-down hover:bg-down-wash",
};

/** A disabled (not busy) button drops its fill so it never reads as actionable. */
const INERT = "border border-line bg-surface text-ink-3";

/** 32 / 40 / 48 px (sm grows to 40 on touch screens). */
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-[14px] pointer-coarse:h-10",
  md: "h-10 gap-2 px-4 text-[14px]",
  lg: "h-12 gap-2 px-5 text-[15px]",
};

const BASE =
  "group/button inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-sm [font-weight:560] leading-none " +
  "transition-[background-color,color,border-color,transform] duration-(--dur-1) ease-(--ease-out) active:scale-[.98] " +
  "disabled:pointer-events-none aria-disabled:pointer-events-none";

export function buttonClass({
  variant = "secondary",
  size = "md",
  inert = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  inert?: boolean;
  className?: string;
} = {}) {
  return cn(BASE, inert ? INERT : VARIANTS[variant], SIZES[size], className);
}

/**
 * Stripe's CTA hover (§3.6): the chevron slides 3px and grows a stem into an arrow. Inherits the
 * hover from the closest `group/button` (every Button/ButtonLink).
 */
export function ArrowChevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
      className={cn("shrink-0 overflow-visible", className)}
    >
      <path
        d="M1 6h7.5"
        className="opacity-0 transition-opacity duration-300 ease-(--ease-out) group-hover/button:opacity-100"
      />
      <path
        d="M4.5 2 8.5 6l-4 4"
        className="transition-transform duration-300 ease-(--ease-out) group-hover/button:translate-x-[3px]"
      />
    </svg>
  );
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (lucide at 16px, stroke 1.5). Replaced by a spinner while `busy`. */
  icon?: ReactNode;
  /** Trailing chevron → arrow on hover, for navigational CTAs ("Open app →"). */
  arrow?: boolean;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, CommonProps {
  /**
   * Work in progress: keeps the variant fill, shows a spinner and blocks clicks. Pair it with
   * stage copy, e.g. `{busy ? TX_STAGE_LABEL[stage] : "Buy $MOSH"}`. `disabled` (not busy) greys out.
   */
  busy?: boolean;
}

export function Button({ variant, size, busy, icon, arrow, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={buttonClass({ variant, size, inert: disabled && !busy, className })}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Spinner /> : icon}
      {children}
      {arrow ? <ArrowChevron /> : null}
    </button>
  );
}

type LinkProps = ComponentProps<typeof Link> & CommonProps;

/** A Next `<Link>` styled as a button. External URLs: use `ButtonAnchor`. */
export function ButtonLink({ variant, size, icon, arrow, className, children, ...rest }: LinkProps) {
  return (
    <Link className={buttonClass({ variant, size, className })} {...rest}>
      {icon}
      {children}
      {arrow ? <ArrowChevron /> : null}
    </Link>
  );
}

/** An external `<a>` styled as a button; opens in a new tab. */
export function ButtonAnchor({
  variant,
  size,
  icon,
  arrow,
  className,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & CommonProps) {
  return (
    <a target="_blank" rel="noreferrer" className={buttonClass({ variant, size, className })} {...rest}>
      {icon}
      {children}
      {arrow ? <ArrowChevron /> : null}
    </a>
  );
}

const ICON_SIZES: Record<Exclude<ButtonSize, "lg">, string> = {
  sm: "size-8 pointer-coarse:size-10",
  md: "size-10",
};

/** Square icon-only button. `label` is required: it becomes the accessible name and the title. */
export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  busy,
  className,
  children,
  disabled,
  type,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  label: string;
  variant?: Extract<ButtonVariant, "ghost" | "secondary" | "primary">;
  size?: Exclude<ButtonSize, "lg">;
  busy?: boolean;
}) {
  return (
    <button
      type={type ?? "button"}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        BASE,
        "px-0",
        disabled && !busy ? INERT : VARIANTS[variant],
        ICON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {busy ? <Spinner /> : children}
    </button>
  );
}
