import type { Dictionary } from '@/i18n/dictionaries';
import { Alert, Eye, EyeOff } from './icons';
import { Container, Eyebrow, Lede, Section, SectionTitle } from './ui';

/**
 * Three headings, and the third is the point.
 *
 * "We take your privacy seriously" is what everyone writes. What separates a
 * claim you can believe from one you can't is naming yourself as an excluded
 * party ("not even us"), itemising what you *do* hold, and then saying plainly
 * what the design does not protect against. The last list is uncomfortable to
 * write, which is exactly why it is worth more than a badge.
 *
 * Nothing here claims an audit or a certification, because there isn't one.
 */
export function PrivacySection({ t }: { t: Dictionary['privacy'] }) {
  const columns = [
    { key: 'cant', Icon: EyeOff, items: t.cant, accent: true },
    { key: 'does', Icon: Eye, items: t.does, accent: false },
    { key: 'wont', Icon: Alert, items: t.wont, accent: false },
  ] as const;

  const headings = [t.cantTitle, t.doesTitle, t.wontTitle];

  return (
    <Section id="privacy" ground="paper">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow index="05">{t.eyebrow}</Eyebrow>
          <SectionTitle className="mt-5">{t.title}</SectionTitle>
          <Lede className="mt-4">{t.body}</Lede>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-xl bg-line lg:grid-cols-3">
          {columns.map((column, index) => (
            <section key={column.key} className="bg-surface p-6 sm:p-7">
              <h3 className="flex items-center gap-2.5 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
                <column.Icon
                  className={`h-4 w-4 shrink-0 ${column.accent ? 'text-accent' : 'text-ink-3'}`}
                  aria-hidden="true"
                />
                {headings[index]}
              </h3>

              <ul className="mt-5 space-y-4">
                {column.items.map((item) => (
                  <li key={item.title}>
                    <p className="text-[0.875rem] font-medium text-ink">{item.title}</p>
                    <p className="mt-1 text-[0.8125rem] leading-[1.6] text-ink-2">{item.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-6 max-w-3xl text-[0.8125rem] leading-relaxed text-ink-3">{t.footnote}</p>
      </Container>
    </Section>
  );
}
