import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Check, Mic, Users } from './icons';
import { Button, Kicker } from './ui';

/**
 * "Do it by talking to your assistant" — the home page's pointer to /mcp: six
 * things worth asking, what comes back, which MCP tools do it, and the safety
 * facts that decide whether somebody clicks through. Every claim here is one
 * /mcp states in full and is checked against apps/agent-mcp (consent screen,
 * RLS, `record_settlement` only records, `payment_link` only builds a link).
 */

function Ico({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'h-5 w-5'}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const Swap = (p: { className?: string }) => (
  <Ico {...p}>
    <path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4" />
  </Ico>
);
const Card = (p: { className?: string }) => (
  <Ico {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="M3 10h18M7 15h3" />
  </Ico>
);
const UserPlus = (p: { className?: string }) => (
  <Ico {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c.4-3 2.5-4.8 5.5-4.8s5.1 1.8 5.5 4.8M18 8v6M15 11h6" />
  </Ico>
);
const Pencil = (p: { className?: string }) => (
  <Ico {...p}>
    <path d="M12 5H6.5A2.5 2.5 0 0 0 4 7.5v10A2.5 2.5 0 0 0 6.5 20h10a2.5 2.5 0 0 0 2.5-2.5V12" />
    <path d="m17.5 3.5 3 3L12 15l-4 1 1-4z" />
  </Ico>
);
const History = (p: { className?: string }) => (
  <Ico {...p}>
    <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4M12 8v4l3 2" />
  </Ico>
);
const Sync = (p: { className?: string }) => (
  <Ico {...p}>
    <path d="M19 9a7 7 0 0 0-12.5-2M5 4v3.5h3.5M5 15a7 7 0 0 0 12.5 2M19 20v-3.5h-3.5" />
  </Ico>
);
const Link = (p: { className?: string }) => (
  <Ico {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Ico>
);
const Shield = (p: { className?: string }) => (
  <Ico {...p}>
    <path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6z" />
    <path d="m9 12 2.2 2.2L15 10" />
  </Ico>
);
const Padlock = (p: { className?: string }) => (
  <Ico {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" />
  </Ico>
);
const Next = () => (
  <Ico className="h-4 w-4 text-ink-3 rtl:-scale-x-100">
    <path d="m9 6 6 6-6 6" />
  </Ico>
);

const HEAD_ICONS = [Users, Swap, Card, UserPlus, Pencil, History];
// Status-style results (cards 2-5): leading icon, trailing icon.
const LEAD_ICONS = [null, Users, Check, Users, Sync, null];
const SAFETY_ICONS = [Shield, Padlock, Users, Link];

export function AgentsBand({ t, locale }: { t: Dictionary['agents']; locale: Locale }) {
  return (
    <section
      id="agents"
      aria-labelledby="agents-title"
      className="on-light scroll-mt-20 py-6 lg:py-8"
    >
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="grid items-end gap-4 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
          <div>
            <Kicker>{t.eyebrow}</Kicker>
            <h2
              id="agents-title"
              className="display mt-1.5 text-balance text-[2rem] text-ink sm:text-[2.6rem]"
            >
              {t.title}
            </h2>
            <p className="mt-1.5 text-[1rem] text-ink-2">{t.lead}</p>
          </div>
          <div>
            <p className="text-[0.84rem] leading-[1.55] text-ink-2">{t.body}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-2">
              <span className="text-[0.75rem] font-semibold tracking-[0.1em] rtl:tracking-normal text-ink-3 uppercase">
                {t.clientsLabel}
              </span>
              {t.clients.map((name) => (
                <span
                  key={name}
                  className="inline-flex h-7 items-center rounded-full bg-surface px-3 text-[0.78rem] font-medium text-ink shadow-[var(--w-shadow-sm)]"
                >
                  {name}
                </span>
              ))}
              <Button href={`/${locale}/mcp`} className="ms-auto">
                {t.cta}
              </Button>
            </div>
          </div>
        </div>

        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.examples.map((ex, i) => {
            const Head = HEAD_ICONS[i];
            const Lead = LEAD_ICONS[i];
            const isRows = ex.rows.length > 0;
            return (
              <li
                key={ex.title}
                className="flex flex-col gap-3 rounded-[1.4rem] bg-surface p-4 shadow-[var(--w-shadow-card)]"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-wash text-accent">
                    <Head className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[1.02rem] leading-tight font-bold text-ink">{ex.title}</h3>
                    <p className="mt-0.5 text-[0.84rem] leading-snug text-ink-2">{ex.sub}</p>
                  </div>
                </div>

                <p className="flex items-start gap-2 self-start rounded-2xl bg-accent-wash px-3 py-2 text-[0.88rem] leading-[1.4] font-medium text-ink">
                  <Mic className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>“{ex.ask}”</span>
                </p>

                <div className="rounded-2xl bg-surface p-2.5 ring-1 ring-line/80 ring-inset">
                  {isRows ? (
                    <ul className="divide-y divide-divider">
                      {ex.rows.map((row) => (
                        <li
                          key={row.k}
                          className="flex items-center justify-between gap-3 py-1.5 text-[0.9rem] first:pt-0.5 last:pb-0.5"
                        >
                          <span className="flex items-center gap-2.5 text-ink">
                            {i === 0 ? (
                              <span
                                aria-hidden="true"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent-wash text-[0.75rem] font-bold text-accent"
                              >
                                {row.k.slice(0, 1)}
                              </span>
                            ) : null}
                            <bdi>{row.k}</bdi>
                          </span>
                          <bdi className="font-semibold text-ink tabular-nums">{row.v}</bdi>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex items-center gap-3">
                      {Lead ? (
                        <span
                          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                            i === 2 ? 'bg-[#dcf7e6] text-[#1f9d55]' : 'bg-accent-wash text-accent'
                          }`}
                        >
                          <Lead className="h-[1.15rem] w-[1.15rem]" />
                        </span>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.92rem] leading-tight font-semibold text-ink">
                          {ex.reply}
                        </p>
                        <p className="mt-0.5 text-[0.8rem] leading-snug text-ink-2">
                          {ex.replySub}
                        </p>
                      </div>
                      {i === 2 ? (
                        <Next />
                      ) : i === 3 ? (
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
                          <Link className="h-4 w-4" />
                        </span>
                      ) : (
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#dcf7e6] text-[#1f9d55]">
                          <Check className="h-4 w-4" />
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <p dir="ltr" className="mt-auto flex flex-wrap items-center gap-1.5 text-start">
                  <span className="text-[0.8rem] font-medium text-ink-2">{t.toolsLabel}:</span>
                  {ex.tools.map((tool) => (
                    <code
                      key={tool}
                      className="rounded-full bg-accent-wash px-2.5 py-1 font-mono text-[0.72rem] text-ink-2"
                    >
                      {tool}
                    </code>
                  ))}
                </p>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex flex-col gap-3 rounded-[1.4rem] bg-surface p-4 shadow-[var(--w-shadow-card)] lg:flex-row lg:items-center lg:gap-0 lg:px-6">
          <p className="text-[1.05rem] font-bold text-ink lg:w-[17%]">{t.safetyTitle}</p>
          <ul className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
            {t.safety.map((line, i) => {
              const I = SAFETY_ICONS[i];
              return (
                <li
                  key={line}
                  className="flex items-center gap-3 text-[0.84rem] leading-snug text-ink-2 lg:border-s lg:border-line lg:px-5"
                >
                  <I className="h-7 w-7 shrink-0 text-accent" />
                  {line}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
