import type { Dictionary } from '@/i18n/dictionaries';
import { site } from '@/lib/site';
import { ArrowRight, Check, Github } from './icons';
import { Kicker } from './ui';

/** "Open source". The repo is public under AGPL-3.0; claims here are limited to that. */
export function OpenSourceBand({ t }: { t: Dictionary['openSource'] }) {
  return (
    <section
      id="open-source"
      aria-labelledby="open-source-title"
      className="scroll-mt-20 py-6 lg:py-8"
    >
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="grid items-start gap-6 overflow-hidden rounded-[1.75rem] bg-surface p-5 shadow-[var(--w-shadow-card)] sm:p-7 lg:grid-cols-[1fr_1.05fr] lg:gap-10">
          <div>
            <Kicker>{t.eyebrow}</Kicker>
            <h2
              id="open-source-title"
              className="mt-1.5 text-balance text-[1.5rem] leading-[1.15] font-bold tracking-[-0.02em] text-ink sm:text-[1.9rem]"
            >
              {t.title}
            </h2>
            <p className="mt-2.5 text-[0.92rem] leading-[1.6] text-ink-2">{t.body}</p>
            <a
              href={site.githubUrl}
              rel="noopener"
              className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink"
            >
              <Github className="h-[1.1rem] w-[1.1rem]" />
              {t.cta}
              <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
            </a>
          </div>
          <ul className="space-y-2.5 rounded-2xl bg-accent-wash p-4">
            {t.points.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[0.88rem] text-ink-2">
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
