import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight, Check, Minus } from './icons';
import { Container, Eyebrow, Lede, Section, SectionTitle } from './ui';

/**
 * Two plans, one table, no currency in the headline number.
 *
 * A price printed in one country's currency is a locale error in the most
 * trust-sensitive part of the page, so Free is the word "free" and the real
 * amount is resolved at checkout in the visitor's own money. The paid tier is
 * not priced yet and says so in those words — "early access" with no number is
 * the consumer form of "contact us", and pretending otherwise is worse than
 * admitting it.
 *
 * The comparison uses an empty cell rather than a red cross: absence is
 * information, not a failure.
 */
export function Pricing({ t, appUrl }: { t: Dictionary['pricing']; appUrl: string }) {
  return (
    <Section id="pricing">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow index="07">{t.eyebrow}</Eyebrow>
          <SectionTitle className="mt-5">{t.title}</SectionTitle>
          <Lede className="mt-4">{t.subtitle}</Lede>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          {t.plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-xl p-6 sm:p-8 ${
                plan.featured
                  ? 'bg-surface shadow-[var(--w-shadow-lg)]'
                  : 'border border-line bg-transparent'
              }`}
            >
              {plan.badge ? (
                // Straddling the card's own top edge — the cheapest signal on
                // the page that something was designed rather than defaulted.
                <span className="absolute -top-2.5 start-6 rounded-sm bg-accent px-2 py-0.5 font-mono text-[0.6875rem] text-accent-ink">
                  {plan.badge}
                </span>
              ) : null}

              <p className="font-mono text-[0.75rem] tracking-[0.1em] text-ink-3 uppercase">
                {plan.name}
              </p>

              <p className="mt-4 flex items-baseline gap-2">
                <span className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] text-ink">
                  {plan.price}
                </span>
                {plan.period ? (
                  <span className="font-mono text-[0.8125rem] text-ink-3">{plan.period}</span>
                ) : null}
              </p>

              <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{plan.tagline}</p>

              <ul className="mt-7 flex-1 space-y-3">
                {plan.inherits ? (
                  <li className="flex items-center gap-2.5 border-b border-line pb-3 text-[0.875rem] text-ink-2">
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 -scale-x-100 text-ink-3 rtl:scale-x-100"
                      aria-hidden="true"
                    />
                    {plan.inherits}
                  </li>
                ) : null}
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-[0.875rem] text-ink-2">
                    <Check
                      className="mt-[0.2rem] h-3.5 w-3.5 shrink-0 text-accent"
                      aria-hidden="true"
                    />
                    {feature}
                  </li>
                ))}
              </ul>

              <a
                href={appUrl}
                className={`mt-8 flex h-12 items-center justify-center rounded-md text-sm font-medium transition-transform duration-150 active:translate-y-px ${
                  plan.featured ? 'border border-line text-ink hover:bg-chip' : 'bg-ink text-bg'
                }`}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>

        {/* The honest comparison: what each tier actually includes. It is wider
            than a phone, so its scroller is a keyboard stop with a name —
            otherwise the far columns are reachable only with a mouse. */}
        <div
          tabIndex={0}
          role="group"
          aria-label={t.table.caption}
          className="mt-10 overflow-x-auto"
        >
          <table className="w-full min-w-[34rem] border-collapse text-start">
            <caption className="pb-4 text-start font-mono text-[0.75rem] tracking-[0.08em] text-ink-3 uppercase">
              {t.table.caption}
            </caption>
            <thead>
              <tr className="border-y border-line">
                <th
                  scope="col"
                  className="py-2.5 pe-4 text-start text-[0.8125rem] font-medium text-ink-2"
                >
                  {t.table.head}
                </th>
                {t.plans.map((plan) => (
                  <th
                    key={plan.name}
                    scope="col"
                    className="w-24 py-2.5 text-center font-mono text-[0.75rem] font-normal tracking-[0.06em] text-ink-2 uppercase"
                  >
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {t.table.rows.map((row) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    className="py-3 pe-4 text-start text-[0.875rem] font-normal text-ink"
                  >
                    {row.label}
                  </th>
                  {[row.free, row.plus].map((cell, index) => (
                    <td key={index} className="py-3 text-center">
                      {cell === true ? (
                        <>
                          <Check className="mx-auto h-4 w-4 text-accent" aria-hidden="true" />
                          <span className="sr-only">{t.table.included}</span>
                        </>
                      ) : cell === false ? (
                        <>
                          <Minus className="mx-auto h-4 w-4 text-ink-3/50" aria-hidden="true" />
                          <span className="sr-only">{t.table.notIncluded}</span>
                        </>
                      ) : (
                        <span className="font-mono tabular text-[0.8125rem] text-ink-2">
                          {cell}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-6 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-3">{t.billedNote}</p>
      </Container>
    </Section>
  );
}
