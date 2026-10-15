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
          <div className="grid items-end gap-5 lg:grid-cols-[1.2fr_1fr] lg:gap-10">
            <div>
              <Kicker>{t.eyebrow}</Kicker>
              <h2
                id="agents-title"
                className="mt-1.5 text-balance text-[1.5rem] leading-[1.15] font-bold tracking-[-0.02em] text-ink sm:text-[1.9rem]"
              >
                {t.title}
              </h2>
              <p className="mt-2.5 text-[0.92rem] leading-[1.6] text-ink-2">{t.body}</p>
            </div>

            <div>
              <p className="text-[0.75rem] font-semibold tracking-[0.1em] rtl:tracking-normal text-ink-3 uppercase">
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
              <Button href={`/${locale}/mcp`} size="lg" className="mt-4">
                {t.cta}
              </Button>
            </div>
          </div>

          <p className="mt-6 text-[0.75rem] font-semibold tracking-[0.1em] rtl:tracking-normal text-ink-3 uppercase">
            {t.examplesLabel}
          </p>
          <ul className="mt-2.5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {t.examples.map((ex) => (
              <li key={ex.ask} className="flex flex-col gap-2.5">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
                    <Spark className="h-3.5 w-3.5" />
                  </span>
                  <span className="rounded-2xl rounded-ss-md bg-surface px-3.5 py-2 text-[0.9rem] leading-[1.45] font-medium text-ink shadow-[var(--w-shadow-sm)]">
                    {ex.ask}
                  </span>
                </div>
                <div className="flex flex-1 flex-col rounded-2xl bg-surface/70 p-3 ring-1 ring-line/70 ring-inset">
                  <p className="text-[0.86rem] leading-[1.5] text-ink">{ex.reply}</p>
                  {ex.rows.length > 0 ? (
                    <ul className="mt-2 divide-y divide-divider rounded-xl bg-surface px-3 shadow-[var(--w-shadow-sm)]">
                      {ex.rows.map((row) => (
                        <li
                          key={row.k}
                          className="flex items-center justify-between gap-3 py-1.5 text-[0.84rem]"
                        >
                          <bdi className="text-ink-2">{row.k}</bdi>
                          <bdi className="font-semibold text-ink tabular-nums">{row.v}</bdi>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {ex.link ? (
                    <p
                      dir="ltr"
                      className="mt-2 rounded-xl bg-surface px-3 py-2 text-start font-mono text-[0.72rem] leading-snug break-all text-accent shadow-[var(--w-shadow-sm)]"
                    >
                      {ex.link}
                    </p>
                  ) : null}
                  <p
                    dir="ltr"
                    className="mt-auto flex flex-wrap items-center gap-1.5 pt-2.5 text-start"
                  >
                    <span className="text-[0.66rem] font-semibold tracking-[0.1em] rtl:tracking-normal text-ink-3 uppercase">
                      {t.toolsLabel}
                    </span>
                    {ex.tools.map((tool) => (
                      <code
                        key={tool}
                        className="rounded-md bg-chip px-1.5 py-0.5 font-mono text-[0.7rem] text-ink-2"
                      >
                        {tool}
                      </code>
                    ))}
                  </p>
                </div>
              </li>
            ))}
          </ul>

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
