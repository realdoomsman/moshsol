import { Loader2 } from "lucide-react";
import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "up" | "down";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-lime text-black hover:bg-lime-soft enabled:shadow-[0_8px_30px_-10px_rgb(198_255_61/0.6)] aria-disabled:shadow-none",
  secondary: "border border-line bg-white/[0.05] text-ink hover:border-line-strong hover:bg-white/[0.09]",
  ghost: "text-muted hover:bg-white/[0.06] hover:text-ink",
  danger: "border border-down/30 bg-down/10 text-down hover:bg-down/20",
  up: "bg-up text-black hover:brightness-110 enabled:shadow-[0_8px_30px_-10px_rgb(47_230_167/0.55)]",
  down: "bg-down text-black hover:brightness-110 enabled:shadow-[0_8px_30px_-10px_rgb(255_92_124/0.55)]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-10 gap-1.5 rounded-lg px-3 text-[13px] sm:h-8",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
  lg: "h-12 gap-2 rounded-xl px-5 text-[15px]",
};

// Disabled-but-not-busy buttons drop their fill so they never read as actionable; busy buttons
// (spinner) keep their colour so the pending action stays recognisable.
const INERT =
  "data-[inert=true]:border data-[inert=true]:border-line data-[inert=true]:bg-white/[0.04] data-[inert=true]:text-dim data-[inert=true]:shadow-none data-[inert=true]:opacity-100 data-[inert=true]:brightness-100";

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(
    "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition duration-150",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60",
    VARIANTS[variant],
    SIZES[size],
    INERT,
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant, size, loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      data-inert={disabled && !loading ? true : undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
