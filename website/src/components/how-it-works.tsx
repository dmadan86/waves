import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight } from './icons';
import { Container, Eyebrow, Section, SectionTitle } from './ui';

export function HowItWorks({ t }: { t: Dictionary['how'] }) {
  return (
    <Section id="how" ground="paper">
      <Container>
        <div className="max-w-3xl">
          <Eyebrow index="02">{t.eyebrow}</Eyebrow>
          <SectionTitle className="mt-5">{t.title}</SectionTitle>
        </div>

        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          {t.steps.map((step, index) => (
            <article
              key={step.number}
              className="relative overflow-hidden rounded-[1.5rem] border border-line bg-surface p-6 shadow-[var(--w-shadow-sm)]"
            >
              <span className="font-mono text-[0.72rem] text-accent">{step.number}</span>
              <div className="mt-14">
                <h3 className="text-[1.15rem] font-semibold tracking-[-0.02em] text-ink">
                  {step.title}
                </h3>
                <p className="mt-3 text-[0.9rem] leading-[1.7] text-ink-2">{step.body}</p>
              </div>
              <div className="absolute end-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-accent-wash text-accent">
                <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
              </div>
            </article>
          ))}
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[1.5rem] bg-[#171321] p-7 text-white shadow-[var(--w-shadow-lg)]">
            <p className="font-mono text-[0.68rem] tracking-[0.12em] text-white/55 uppercase">
              {t.example.label}
            </p>
            <p className="mt-4 max-w-xl text-[1.35rem] font-semibold tracking-[-0.025em]">
              {t.example.setup}
            </p>
            <div className="mt-8 grid grid-cols-3 gap-2 border-y border-white/10 py-4">
              {t.example.expenses.map((expense) => (
                <div key={expense.what}>
                  <p className="truncate text-[0.78rem] text-white/55">{expense.what}</p>
                  <p className="mt-0.5 font-mono text-[0.66rem] leading-snug text-white/55">
                    {expense.who}
                  </p>
                  <p className="mt-1 font-mono text-[0.85rem] text-white/90">{expense.amount}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 font-mono text-[0.68rem] tracking-[0.12em] text-white/55 uppercase">
              {t.example.resultLabel}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {t.example.payments.map((payment) => (
                <span
                  key={payment.line}
                  className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-2 text-[0.78rem] text-white/80"
                >
                  <ArrowRight className="h-3.5 w-3.5 text-brand-300 rtl:-scale-x-100" />
                  {payment.line}
                  <span className="font-mono text-white">{payment.amount}</span>
                </span>
              ))}
            </div>
            <p className="mt-5 max-w-2xl text-[0.78rem] leading-relaxed text-white/45">
              {t.example.note}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {t.cards.map((card, index) => (
              <div
                key={card.number}
                className={`rounded-[1.5rem] border border-line p-6 ${index === 0 ? 'bg-accent-wash' : 'bg-surface'}`}
              >
                <p
                  className={`font-mono text-[0.68rem] uppercase tracking-[0.1em] ${index === 0 ? 'text-ink-2' : 'text-ink-3'}`}
                >
                  {card.number}
                </p>
                <p className="mt-12 text-[1.05rem] font-semibold text-ink">{card.title}</p>
                <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-2">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </Section>
  );
}
