import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight } from './icons';
import { Container, Eyebrow, Section, SectionTitle } from './ui';

/**
 * Three verbs told you nothing. This is the same three steps as an editorial
 * band — hairlines, no cards, no icons — beside one worked example carried all
 * the way to the payments it produces, because "will this get awkward at the
 * end" is the objection the category actually has, and the only honest answer
 * is to show the end.
 */
export function HowItWorks({ t }: { t: Dictionary['how'] }) {
  return (
    <Section id="how">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow index="03">{t.eyebrow}</Eyebrow>
          <SectionTitle className="mt-5">{t.title}</SectionTitle>
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_0.85fr] lg:gap-16">
          <ol className="border-t border-line">
            {t.steps.map((step) => (
              <li
                key={step.number}
                className="grid gap-x-6 gap-y-2 border-b border-line py-7 sm:grid-cols-[3.5rem_1fr]"
              >
                <span
                  aria-hidden="true"
                  className="font-mono text-[0.8125rem] tracking-[0.06em] text-accent"
                >
                  {step.number}
                </span>
                <div>
                  <h3 className="text-[1.0625rem] font-semibold tracking-[-0.015em] text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-2 max-w-md text-pretty text-[0.9375rem] leading-[1.6] text-ink-2">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {/* The worked example. Four people, three bills, two payments. */}
          <figure className="panel-raised self-start overflow-hidden">
            <figcaption className="border-b border-line px-4 py-2.5 font-mono text-[0.6875rem] tracking-[0.08em] text-ink-3 uppercase">
              {t.example.label}
            </figcaption>

            <p className="px-4 pt-4 text-[0.9375rem] text-ink">{t.example.setup}</p>

            <ul className="mt-3 divide-y divide-divider border-y border-line">
              {t.example.expenses.map((expense) => (
                <li key={expense.what} className="flex items-baseline gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] text-ink">{expense.what}</span>
                    <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-ink-3">
                      {expense.who}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono tabular text-[0.8125rem] text-ink-2">
                    {expense.amount}
                  </span>
                </li>
              ))}
            </ul>

            <div className="px-4 py-4">
              <p className="font-mono text-[0.6875rem] tracking-[0.08em] text-ink-3 uppercase">
                {t.example.resultLabel}
              </p>
              <ul className="mt-2.5 space-y-2">
                {t.example.payments.map((payment) => (
                  <li
                    key={payment.line}
                    className="flex items-center gap-2.5 rounded-md bg-accent-wash px-3 py-2"
                  >
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 text-accent rtl:-scale-x-100"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">
                      {payment.line}
                    </span>
                    <span className="shrink-0 font-mono tabular text-[0.8125rem] font-medium text-ink">
                      {payment.amount}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-2">{t.example.note}</p>
            </div>
          </figure>
        </div>
      </Container>
    </Section>
  );
}
