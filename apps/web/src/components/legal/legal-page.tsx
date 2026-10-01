import type { ReactNode } from "react";

/** Where privacy and account requests go (also the Google consent screen's support email). */
export const LEGAL_CONTACT = "realdoomsalt@gmail.com";
/** Effective date of the current privacy policy and terms; change it with their text. */
const LEGAL_UPDATED = "September 30, 2026";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/** `/privacy` and `/terms`: one readable column in docs typography, a rule above each section. */
export function LegalPage({ title, intro, sections }: { title: string; intro: ReactNode; sections: LegalSection[] }) {
  return (
    <article className="frame-marketing pb-24 pt-10 lg:pt-14">
      <div className="max-w-[720px]">
        <p className="label text-ink-3">Last updated {LEGAL_UPDATED}</p>
        <h1 className="display-m mt-4 text-ink">{title}</h1>
        <div className="body-l mt-5 max-w-[34em] text-ink-2">{intro}</div>
        {sections.map((s) => (
          <section key={s.id} aria-labelledby={s.id} className="mt-12 border-t border-line pt-8">
            <h2 id={s.id} className="h2 text-ink">
              {s.title}
            </h2>
            <div className="mt-4">{s.body}</div>
          </section>
        ))}
      </div>
    </article>
  );
}
