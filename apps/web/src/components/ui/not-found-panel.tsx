import type { ReactNode } from "react";
import { EmptyArt, type EmptyArtKind } from "./empty-art";

/** Full-width 404 / error panel: big status mark, illustration and call-to-action buttons. */
export function NotFoundPanel({
  code = "404",
  art,
  title,
  children,
  actions,
}: {
  code?: string;
  art: EmptyArtKind;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section className="card relative mx-auto mt-6 max-w-2xl overflow-hidden rounded-3xl px-6 py-14 text-center sm:mt-12 sm:py-20">
      <div className="pointer-events-none absolute -top-24 left-1/2 size-80 -translate-x-1/2 rounded-full bg-violet/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 left-1/2 size-72 -translate-x-1/2 rounded-full bg-lime/[0.07] blur-3xl" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-4 font-mono text-[120px] leading-none font-bold tracking-tighter text-white/[0.035] select-none sm:text-[180px]"
      >
        {code}
      </div>
      <EmptyArt kind={art} className="relative mx-auto h-[110px] w-[146px]" />
      <h1 className="type-title relative mt-6 text-3xl sm:text-4xl">{title}</h1>
      <div className="relative mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted">{children}</div>
      <div className="relative mt-8 flex flex-wrap justify-center gap-3">{actions}</div>
    </section>
  );
}
