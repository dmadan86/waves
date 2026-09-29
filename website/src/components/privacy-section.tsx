import type { Dictionary } from '@/i18n/dictionaries';
import { Alert, Eye, EyeOff } from './icons';
import { Container, Eyebrow, Lede, Section, SectionTitle } from './ui';

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
        <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Eyebrow index="05">{t.eyebrow}</Eyebrow>
            <SectionTitle className="mt-5">{t.title}</SectionTitle>
            <Lede className="mt-5">{t.body}</Lede>
          </div>

          <div className="grid gap-3">
            {columns.map((column, index) => (
              <article key={column.key} className="rounded-[1.5rem] border border-line bg-surface p-6 sm:p-7">
                <h3 className="flex items-center gap-2.5 text-[0.95rem] font-semibold text-ink">
                  <column.Icon className={`h-4 w-4 ${column.accent ? 'text-accent' : 'text-ink-3'}`} aria-hidden="true" />
                  {headings[index]}
                </h3>
                <ul className="mt-5 grid gap-4 sm:grid-cols-3">
                  {column.items.map((item) => (
                    <li key={item.title}>
                      <p className="text-[0.84rem] font-medium text-ink">{item.title}</p>
                      <p className="mt-1.5 text-[0.78rem] leading-[1.65] text-ink-2">{item.body}</p>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
        <p className="mt-8 max-w-3xl text-[0.76rem] leading-relaxed text-ink-3">{t.footnote}</p>
      </Container>
    </Section>
  );
}
