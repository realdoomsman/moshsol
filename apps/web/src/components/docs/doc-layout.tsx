import Link from "next/link";
import { DocsMobileNav, DocsNavList, type NavGroup } from "./docs-nav";
import { DocsToc } from "./toc";
import type { DocPage, DocSection } from "./types";

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Docs shell (§4.11): sticky left nav (240px), content (max 720px), "On this page" TOC (200px,
 * ≥ 1280 only). Below 1024px the nav becomes a "Menu" sheet and the TOC is hidden.
 */
export function DocLayout({
  page,
  pages,
  sections,
  updated,
}: {
  page: DocPage;
  pages: DocPage[];
  sections: DocSection[];
  updated: string | null;
}) {
  const href = (p: DocPage) => (p.slug ? `/docs/${p.slug}` : "/docs");
  const groups: NavGroup[] = [];
  for (const p of pages) {
    let g = groups.find((x) => x.group === p.group);
    if (!g) {
      g = { group: p.group, items: [] };
      groups.push(g);
    }
    g.items.push({ href: href(p), label: p.nav });
  }
  const i = pages.indexOf(page);
  const prev = pages[i - 1];
  const next = pages[i + 1];

  return (
    <div className="frame-marketing pb-24 pt-10 lg:pt-14">
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14 xl:grid-cols-[220px_minmax(0,1fr)_200px]">
        <aside className="hidden lg:block">
          <div className="no-scrollbar sticky top-[96px] max-h-[calc(100dvh-136px)] overflow-y-auto pb-8">
            <DocsNavList groups={groups} current={href(page)} />
          </div>
        </aside>

        <article className="min-w-0 max-w-[720px]">
          <div className="mb-6 flex items-center justify-between gap-4">
            <p className="label text-ink-3">Docs · {page.group}</p>
            <DocsMobileNav groups={groups} current={href(page)} title={page.title} />
          </div>
          <h1 className="display-m text-ink">{page.title}</h1>
          <p className="body-l mt-5 max-w-[34em] text-ink-2">{page.description}</p>
          {sections.map((s) => (
            <section key={s.id} aria-labelledby={s.id} className="mt-16 border-t border-line pt-10 first-of-type:mt-12">
              <h2 id={s.id} className="h2 group text-ink">
                <a href={`#${s.id}`} className="rounded-xs hover:underline hover:decoration-ink-3 hover:underline-offset-4">
                  {s.title}
                </a>
              </h2>
              <div className="mt-4">{s.body}</div>
            </section>
          ))}
          <footer className="mt-16 border-t border-line pt-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {prev ? (
                <Link
                  href={href(prev)}
                  className="rounded-md border border-line bg-surface p-4 transition-colors hover:border-line-2 hover:bg-raised"
                >
                  <span className="label block text-ink-3">Previous</span>
                  <span className="ui mt-1 block text-ink">← {prev.nav}</span>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link
                  href={href(next)}
                  className="rounded-md border border-line bg-surface p-4 text-right transition-colors hover:border-line-2 hover:bg-raised"
                >
                  <span className="label block text-ink-3">Next</span>
                  <span className="ui mt-1 block text-ink">{next.nav} →</span>
                </Link>
              ) : null}
            </div>
            {updated ? <p className="micro mt-6 text-ink-3">Last updated {dateFmt.format(new Date(updated))}</p> : null}
          </footer>
        </article>

        <aside className="hidden xl:block">
          <div className="sticky top-[96px]">
            <DocsToc items={sections.map((s) => ({ id: s.id, title: s.title }))} />
          </div>
        </aside>
      </div>
    </div>
  );
}
