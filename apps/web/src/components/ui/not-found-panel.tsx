import type { ReactNode } from "react";

/** Full-width 404 / error panel with a big status mark and call-to-action buttons. */
export function NotFoundPanel({
  code = "404",
  icon,
  title,
  children,
  actions,
}: {
  code?: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section className="animate-in relative mx-auto mt-6 max-w-2xl overflow-hidden rounded-3xl border border-line bg-white/[0.02] px-6 py-14 text-center sm:mt-12 sm:py-20">
      <div className="pointer-events-none absolute -top-24 left-1/2 size-80 -translate-x-1/2 rounded-full bg-violet/15 blur-3xl" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-6 font-mono text-[120px] leading-none font-bold tracking-tighter text-white/[0.035] select-none sm:text-[180px]"
      >
        {code}
      </div>
      <div className="relative mx-auto grid size-14 place-items-center rounded-2xl border border-line-strong bg-white/[0.05] text-lime">
        {icon}
      </div>
      <h1 className="relative mt-6 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h1>
      <div className="relative mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted">{children}</div>
      <div className="relative mt-8 flex flex-wrap justify-center gap-3">{actions}</div>
    </section>
  );
}
