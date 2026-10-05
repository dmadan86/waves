import type { Dictionary } from '@/i18n/dictionaries';
import { Compass, Heart, Users } from './icons';
import { Container, Eyebrow, Section, SectionTitle } from './ui';

const icons = [Compass, Users, Heart] as const;

export function Audience({ t }: { t: Dictionary['audience'] }) {
  return (
    <Section className="lg:py-32">
      <Container>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <Eyebrow index="03">{t.eyebrow}</Eyebrow>
            <SectionTitle className="mt-5">{t.title}</SectionTitle>
          </div>
          <p className="max-w-sm font-mono text-[0.7rem] leading-relaxed text-ink-3">{t.tagline}</p>
        </div>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {t.items.map((item, index) => {
            const Icon = icons[index] ?? Compass;
            return (
              <article
                key={item.title}
                className="group min-h-[17rem] rounded-[1.5rem] border border-line bg-surface p-6 transition-all hover:-translate-y-1 hover:border-accent/35 hover:shadow-[var(--w-shadow-md)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chip text-ink-2 transition group-hover:bg-accent-wash group-hover:text-accent">
                  <Icon className="h-4 w-4" />
                </div>
                <h3 className="mt-14 text-[1.1rem] font-semibold tracking-[-0.02em] text-ink">
                  {item.title}
                </h3>
                <p className="mt-3 text-[0.84rem] leading-[1.7] text-ink-2">{item.body}</p>
              </article>
            );
          })}
        </div>
      </Container>
    </Section>
  );
}
