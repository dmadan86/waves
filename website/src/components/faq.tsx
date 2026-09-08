import type { Dictionary } from '@/i18n/dictionaries';
import { Container, Eyebrow, Section, SectionTitle } from './ui';

/**
 * Hairline rows, no boxes, and the question set large enough to be the thing
 * you scan. Native `<details>` rather than a scripted accordion: it opens with
 * JavaScript off, it is already keyboard-operable and announced correctly, and
 * the browser's own find-in-page can reach text inside a closed one.
 *
 * The heading column is sticky, so the list can grow past six without the
 * heading scrolling away.
 */
export function Faq({ t }: { t: Dictionary['faq'] }) {
  return (
    <Section id="faq" ground="paper">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Eyebrow index="08">{t.eyebrow}</Eyebrow>
            <SectionTitle className="mt-5">{t.title}</SectionTitle>
            <p className="mt-5 text-[0.9375rem] leading-relaxed text-ink-2">
              {t.helpBefore}{' '}
              <a
                href={`mailto:${t.helpEmail}`}
                className="rounded-xs text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-accent"
              >
                {t.helpEmail}
              </a>
              .
            </p>
          </div>

          <div className="border-t border-line">
            {t.items.map((item) => (
              <details key={item.q} className="group border-b border-line">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5 text-start text-[1.0625rem] leading-snug text-ink-2 transition-colors duration-150 group-open:text-ink hover:text-ink [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden="true"
                    className="relative mt-2 h-3 w-3 shrink-0 text-ink-3 group-open:text-accent"
                  >
                    <span className="absolute top-1/2 start-0 h-px w-3 -translate-y-1/2 bg-current" />
                    <span className="absolute top-1/2 start-0 h-px w-3 -translate-y-1/2 rotate-90 bg-current transition-transform duration-200 group-open:rotate-0" />
                  </span>
                </summary>
                <p className="max-w-2xl pb-6 text-[0.9375rem] leading-[1.65] text-ink-2">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </Container>
    </Section>
  );
}
