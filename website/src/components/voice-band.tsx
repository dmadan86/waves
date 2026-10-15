import type { Dictionary } from '@/i18n/dictionaries';
import { Check, Mic } from './icons';
import { Kicker } from './ui';

type Example = Dictionary['voice']['examples'][number];

/** Right-to-left scripts, by BCP-47 language. Everything else reads left to right. */
const dirOf = (lang: string) => (lang === 'ar' ? 'rtl' : 'ltr');

/**
 * "AI voice". Every example sentence here is a command the agent's prompt
 * (supabase/functions/voice-agent/logic.ts) and the core parser
 * (packages/core/src/voice) are written for, and every result is the card the
 * app shows before saving. Amounts are in each currency's own symbol and sit in
 * `<bdi>` so an Arabic page keeps "₹1,200" and "AED 450" reading correctly.
 */
function ExampleCard({ ex, t }: { ex: Example; t: Dictionary['voice'] }) {
  return (
    <li className="flex flex-col rounded-3xl bg-surface p-3.5 shadow-[var(--w-shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.7rem] font-semibold tracking-[0.1em] rtl:tracking-normal text-ink-3 uppercase">
          {t.sayLabel}
        </span>
        <span
          lang={ex.lang}
          className="inline-flex h-6 items-center rounded-full bg-chip px-2.5 text-[0.7rem] font-medium text-ink-2"
        >
          {ex.tag}
        </span>
      </div>
      <p
        lang={ex.lang}
        dir={dirOf(ex.lang)}
        className="mt-2 flex items-start gap-2 text-start text-[0.96rem] leading-[1.45] font-medium text-ink"
      >
        <Mic className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <span>“{ex.say}”</span>
      </p>

      <div className="mt-3 rounded-2xl bg-accent-wash p-3">
        <p className="text-[0.7rem] font-semibold tracking-[0.1em] rtl:tracking-normal text-ink-3 uppercase">
          {t.doesLabel}
        </p>
        <div className="mt-1.5 flex items-baseline justify-between gap-3">
          <span className="text-[0.95rem] font-semibold text-ink">{ex.title}</span>
          <bdi className="text-[1.05rem] font-bold text-accent tabular-nums">{ex.amount}</bdi>
        </div>
        <ul className="mt-1.5 space-y-0.5">
          {ex.lines.map((line) => (
            <li key={line} className="text-[0.82rem] text-ink-2">
              <bdi>{line}</bdi>
            </li>
          ))}
        </ul>
        <div className="mt-2.5 flex gap-2" aria-hidden="true">
          <span className="inline-flex h-7 items-center rounded-full bg-accent px-3 text-[0.74rem] font-semibold text-accent-ink">
            {t.confirm}
          </span>
          <span className="inline-flex h-7 items-center rounded-full bg-surface px-3 text-[0.74rem] font-medium text-ink-2">
            {t.edit}
          </span>
        </div>
      </div>
    </li>
  );
}

export function VoiceBand({ t }: { t: Dictionary['voice'] }) {
  return (
    <section id="voice" aria-labelledby="voice-title" className="scroll-mt-20 py-6 lg:py-8">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="grid items-end gap-4 lg:grid-cols-[1.2fr_1fr] lg:gap-10">
          <div>
            <Kicker>{t.eyebrow}</Kicker>
            <h2
              id="voice-title"
              className="mt-1.5 text-balance text-[1.5rem] leading-[1.15] font-bold tracking-[-0.02em] text-ink sm:text-[1.9rem]"
            >
              {t.title}
            </h2>
            <p className="mt-2.5 text-[0.92rem] leading-[1.6] text-ink-2">{t.body}</p>
          </div>
          <div>
            <p className="text-[0.75rem] font-semibold tracking-[0.1em] rtl:tracking-normal text-ink-3 uppercase">
              {t.languagesLabel}
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {t.languages.map((name) => (
                <li
                  key={name}
                  className="inline-flex h-9 items-center rounded-full bg-surface px-3.5 text-[0.84rem] font-medium text-ink shadow-[var(--w-shadow-sm)]"
                >
                  {name}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[0.84rem] font-medium text-accent">{t.planLine}</p>
          </div>
        </div>

        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          {t.examples.map((ex) => (
            <ExampleCard key={ex.say} ex={ex} t={t} />
          ))}
        </ul>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr] lg:gap-6">
          <div className="rounded-3xl bg-accent-wash p-4 sm:p-5">
            <p className="text-[0.92rem] font-semibold text-ink">{t.followUp.title}</p>
            <ol className="mt-3 space-y-2 text-[0.9rem]">
              <li className="flex">
                <span className="rounded-2xl rounded-ss-md bg-surface px-3.5 py-2 font-medium text-ink shadow-[var(--w-shadow-sm)]">
                  <bdi lang="en">“{t.followUp.say}”</bdi>
                </span>
              </li>
              <li className="flex justify-end">
                <span className="rounded-2xl rounded-ee-md bg-accent px-3.5 py-2 font-medium text-accent-ink">
                  {t.followUp.ask}
                </span>
              </li>
              <li className="flex">
                <span className="rounded-2xl rounded-ss-md bg-surface px-3.5 py-2 font-medium text-ink shadow-[var(--w-shadow-sm)]">
                  “{t.followUp.answer}”
                </span>
              </li>
              <li className="flex items-center gap-2 pt-1 text-[0.86rem] font-semibold text-accent">
                <Check className="h-4 w-4 shrink-0" />
                <bdi>{t.followUp.done}</bdi>
              </li>
            </ol>
          </div>

          <ul className="space-y-2.5 self-center">
            {t.points.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[0.86rem] text-ink-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
