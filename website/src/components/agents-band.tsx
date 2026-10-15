import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Check, Spark } from './icons';
import { Button, Kicker } from './ui';

/**
 * "Works with your AI assistant" — the home page's pointer to /mcp. Compact on
 * purpose: one line on what MCP is, four things worth asking, who it works
 * with, and the safety facts that decide whether somebody clicks through. Every
 * claim here is one /mcp states in full, and each is checked against the code
 * (consent screen, RLS, no payment tool, per-assistant ceilings).
 */
export function AgentsBand({ t, locale }: { t: Dictionary['agents']; locale: Locale }) {
  return (
    <section id="agents" aria-labelledby="agents-title" className="scroll-mt-20 py-6 lg:py-8">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="agents-card overflow-hidden rounded-[1.75rem] p-5 shadow-[var(--w-shadow-card)] sm:p-7">
          <div className="grid items-start gap-6 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
            <div>
              <Kicker>{t.eyebrow}</Kicker>
              <h2
                id="agents-title"
                className="mt-1.5 text-balance text-[1.5rem] leading-[1.15] font-bold tracking-[-0.02em] text-ink sm:text-[1.9rem]"
              >
                {t.title}
              </h2>
              <p className="mt-2.5 text-[0.92rem] leading-[1.6] text-ink-2">{t.body}</p>

              <p className="mt-5 text-[0.75rem] font-semibold tracking-[0.1em] text-ink-3 uppercase">
                {t.clientsLabel}
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {t.clients.map((name) => (
                  <li
                    key={name}
                    className="inline-flex h-9 items-center rounded-full bg-surface px-3.5 text-[0.84rem] font-medium text-ink shadow-[var(--w-shadow-sm)]"
                  >
                    {name}
                  </li>
                ))}
              </ul>

              <Button href={`/${locale}/mcp`} size="lg" className="mt-6">
                {t.cta}
              </Button>
            </div>

            <div>
              <p className="text-[0.75rem] font-semibold tracking-[0.1em] text-ink-3 uppercase">
                {t.promptsLabel}
              </p>
              <ul className="mt-2.5 space-y-2.5">
                {t.prompts.map((prompt, i) => (
                  <li
                    key={prompt}
                    className={`flex items-start gap-2.5 ${i % 2 === 1 ? 'lg:ps-8' : 'lg:pe-8'}`}
                  >
                    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
                      <Spark className="h-3.5 w-3.5" />
                    </span>
                    <span className="rounded-2xl rounded-ss-md bg-surface px-4 py-2.5 text-[0.9rem] leading-[1.5] font-medium text-ink shadow-[var(--w-shadow-sm)]">
                      {prompt}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-6 border-t border-line/70 pt-4">
            <p className="text-[0.82rem] font-semibold text-ink">{t.safetyTitle}</p>
            <ul className="mt-2.5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {t.safety.map((line) => (
                <li key={line} className="flex items-start gap-2 text-[0.86rem] text-ink-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
