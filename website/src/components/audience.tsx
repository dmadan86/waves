import type { Dictionary } from '@/i18n/dictionaries';
import { Compass, Heart, Home, Wallet } from './icons';
import { Container, Eyebrow, Section, SectionTitle } from './ui';

const icons = [Compass, Home, Heart, Wallet] as const;

/**
 * Four cases, as a rule-separated index rather than four identical cards. The
 * point of this section is scanning, and a card grid asks you to read four
 * boxes of equal weight to find the one that is you.
 */
export function Audience({ t }: { t: Dictionary['audience'] }) {
  return (
    <Section className="py-16 sm:py-20">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
          <div>
            <Eyebrow index="07">{t.eyebrow}</Eyebrow>
            <SectionTitle className="mt-5">{t.title}</SectionTitle>
          </div>

          <ul className="border-t border-line">
            {t.items.map((item, index) => {
              const Icon = icons[index] ?? Compass;
              return (
                <li
                  key={item.title}
                  className="grid gap-x-5 gap-y-1.5 border-b border-line py-5 sm:grid-cols-[10rem_1fr] sm:items-baseline"
                >
                  <h3 className="flex items-center gap-2.5 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
                    <Icon className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                    {item.title}
                  </h3>
                  <p className="text-pretty text-[0.9375rem] leading-[1.6] text-ink-2">
                    {item.body}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      </Container>
    </Section>
  );
}
