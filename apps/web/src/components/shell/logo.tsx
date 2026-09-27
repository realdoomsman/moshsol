import Link from "next/link";
import { cn } from "../ui/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#C6FF3D" />
      <path d="M10.5 14.5v-3a5.5 5.5 0 0 1 11 0v3" stroke="#060708" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <rect x="8" y="15" width="16" height="11" rx="3" fill="#060708" />
      <path
        d="M11 22.4l2.1-2.6 2.1 1.8 2.3-3.2 3.5 3.2"
        stroke="#C6FF3D"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("group inline-flex h-10 items-center gap-2.5 rounded-lg", className)} aria-label="moshsol home">
      <LogoMark className="transition-transform duration-300 group-hover:-rotate-6" />
      <span className="text-[19px] font-semibold tracking-[-0.03em]">
        mosh<span className="text-lime">sol</span>
      </span>
    </Link>
  );
}
