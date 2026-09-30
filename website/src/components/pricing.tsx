import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight, Check, Minus } from './icons';
import { Container, Eyebrow, Lede, Section, SectionTitle } from './ui';

export function Pricing({ t, appUrl }: { t: Dictionary['pricing']; appUrl: string }) {
  return (
    <Section id="pricing" className="lg:py-36">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
          <div>
            <Eyebrow index="07">{t.eyebrow}</Eyebrow>
            <SectionTitle className="mt-5">{t.title}</SectionTitle>
            <Lede className="mt-5">{t.subtitle}</Lede>
            <p className="mt-6 font-mono text-[0.68rem] leading-relaxed text-ink-3">
              {t.billedNote}
            </p>
          </div>

          <div>
            <div className="grid gap-3 sm:grid-cols-2">
              {t.plans.map((plan) => (
                <article
                  key={plan.name}
                  className={`relative flex min-h-[31rem] flex-col rounded-[1.5rem] border p-6 sm:p-7 ${plan.featured ? 'border-accent/40 bg-[#171321] text-white shadow-[var(--w-shadow-lg)]' : 'border-line bg-surface'}`}
                >
                  {plan.badge ? (
                    <span className="absolute right-5 top-5 rounded-full bg-brand-500 px-2.5 py-1 font-mono text-[0.64rem] text-white">
                      {plan.badge}
                    </span>
                  ) : null}
                  <p
                    className={`font-mono text-[0.68rem] tracking-[0.12em] uppercase ${plan.featured ? 'text-white/45' : 'text-ink-3'}`}
                  >
                    {plan.name}
                  </p>
                  <p
                    className={`mt-5 text-[2.4rem] font-semibold tracking-[-0.05em] ${plan.featured ? 'text-white' : 'text-ink'}`}
                  >
                    {plan.price}
                  </p>
                  {plan.period ? (
                    <span
                      className={`mt-1 font-mono text-[0.7rem] ${plan.featured ? 'text-white/45' : 'text-ink-3'}`}
                    >
                      {plan.period}
                    </span>
                  ) : null}
                  <p
                    className={`mt-5 text-[0.88rem] leading-relaxed ${plan.featured ? 'text-white/65' : 'text-ink-2'}`}
                  >
                    {plan.tagline}
                  </p>
                  <ul className="mt-8 flex-1 space-y-3">
                    {plan.inherits ? (
                      <li className="border-b border-white/10 pb-3 text-[0.8rem] text-white/60">
                        {plan.inherits}
                      </li>
                    ) : null}
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className={`flex items-start gap-2.5 text-[0.82rem] ${plan.featured ? 'text-white/72' : 'text-ink-2'}`}
                      >
                        <Check
                          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${plan.featured ? 'text-brand-300' : 'text-accent'}`}
                          aria-hidden="true"
                        />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={appUrl}
                    className={`mt-8 flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold ${plan.featured ? 'bg-white text-[#2c1d73]' : 'bg-ink text-bg'}`}
                  >
                    {plan.cta}
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </article>
              ))}
            </div>

            <div
              tabIndex={0}
              role="group"
              aria-label={t.table.caption}
              className="mt-5 overflow-x-auto rounded-[1.25rem] border border-line bg-surface"
            >
              <table className="w-full min-w-[34rem] border-collapse text-start">
                <caption className="px-5 pb-3 pt-5 text-start font-mono text-[0.68rem] tracking-[0.1em] text-ink-3 uppercase">
                  {t.table.caption}
                </caption>
                <thead>
                  <tr className="border-y border-line">
                    <th className="px-5 py-3 text-start text-[0.78rem] font-medium text-ink-2">
                      {t.table.head}
                    </th>
                    {t.plans.map((plan) => (
                      <th
                        key={plan.name}
                        className="w-24 py-3 text-center font-mono text-[0.68rem] font-normal uppercase text-ink-3"
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
                        className="px-5 py-3 text-start text-[0.8rem] font-normal text-ink"
                      >
                        {row.label}
                      </th>
                      {[row.free, row.plus].map((cell, index) => (
                        <td key={index} className="py-3 text-center">
                          {cell === true ? (
                            <>
                              <Check className="mx-auto h-4 w-4 text-accent" />
                              <span className="sr-only">{t.table.included}</span>
                            </>
                          ) : cell === false ? (
                            <>
                              <Minus className="mx-auto h-4 w-4 text-ink-3/40" />
                              <span className="sr-only">{t.table.notIncluded}</span>
                            </>
                          ) : (
                            <span className="font-mono text-[0.76rem] text-ink-2">{cell}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
