import type { Dictionary } from '@/i18n/dictionaries';
import { site } from '@/lib/site';
import { ArrowRight } from './icons';

const GH_PATH =
  'M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2 0-.4-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3';

function GhMark({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d={GH_PATH} />
    </svg>
  );
}

function Line({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

const Code = ({ className }: { className: string }) => (
  <Line className={className}>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 5l-4 14" />
  </Line>
);
const Scales = ({ className }: { className: string }) => (
  <Line className={className}>
    <path d="M12 3v18M7 21h10M5 6h14M5 6l-3 8a3 3 0 0 0 6 0L5 6ZM19 6l-3 8a3 3 0 0 0 6 0l-3-8Z" />
  </Line>
);
const People = ({ className }: { className: string }) => (
  <Line className={className}>
    <circle cx="12" cy="7" r="3" />
    <path d="M6 20v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1M3 11a2.5 2.5 0 0 1 3-2.4M21 11a2.5 2.5 0 0 0-3-2.4" />
  </Line>
);
const Layers = ({ className }: { className: string }) => (
  <Line className={className}>
    <path d="m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17.5l9 5 9-5" />
  </Line>
);
const Shield = ({ className }: { className: string }) => (
  <Line className={className}>
    <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3ZM9 12l2 2 4-4" />
  </Line>
);

const ICONS = [Code, People, Layers, Shield];

/** Pure CSS/SVG illustration: tilted browser window + GitHub tile on a soft circle. */
function Illustration() {
  return (
    <div aria-hidden="true" className="relative hidden h-52 w-56 shrink-0 xl:block">
      <div className="absolute end-0 top-0 h-44 w-44 rounded-full bg-accent-wash" />
      <div className="absolute start-1 top-9 w-40 -rotate-6 rounded-2xl bg-accent-wash p-2 shadow-[var(--w-shadow-card)] ring-1 ring-line rtl:rotate-6">
        <div className="flex gap-1.5 px-1 pb-2">
          <i className="h-2 w-2 rounded-full bg-[#ff5f57]" />
          <i className="h-2 w-2 rounded-full bg-[#febc2e]" />
          <i className="h-2 w-2 rounded-full bg-[#28c840]" />
        </div>
        <div className="h-24 rounded-lg bg-[#3b3354] p-2.5">
          <p dir="ltr" className="text-xs font-bold text-white/80">
            {'</>'}
          </p>
          <div className="mt-2 space-y-1.5">
            <i className="block h-1.5 w-3/5 rounded-full bg-[#a78bfa]" />
            <i className="block h-1.5 w-1/2 rounded-full bg-white/25" />
            <i className="block h-1.5 w-2/3 rounded-full bg-white/25" />
            <i className="block h-1.5 w-2/5 rounded-full bg-white/25" />
          </div>
        </div>
      </div>
      <div className="absolute bottom-3 end-0 grid h-16 w-16 place-items-center rounded-2xl bg-surface text-ink shadow-[var(--w-shadow-card)] ring-1 ring-line">
        <GhMark className="h-9 w-9" />
      </div>
    </div>
  );
}

/** "Open source". The repo is public under AGPL-3.0; claims here are limited to that. */
export function OpenSourceBand({ t }: { t: Dictionary['openSource'] }) {
  const pill =
    'inline-flex h-9 items-center gap-2 rounded-full bg-accent-wash px-3.5 text-sm font-medium text-accent';
  return (
    <section
      id="open-source"
      aria-labelledby="open-source-title"
      className="on-light scroll-mt-20 py-6 lg:py-8"
    >
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="grid items-center gap-6 overflow-hidden rounded-[1.75rem] bg-surface p-5 shadow-[var(--w-shadow-card)] sm:p-7 lg:grid-cols-[1.1fr_1fr] lg:gap-8 xl:grid-cols-[1.1fr_auto_1fr_auto]">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-accent-wash px-3 py-1.5 text-[0.72rem] font-semibold tracking-[0.12em] text-accent uppercase rtl:tracking-normal">
              <Code className="h-4 w-4" />
              {t.eyebrow}
            </p>
            <h2
              id="open-source-title"
              className="display mt-3 text-balance text-[2rem] text-ink sm:text-[2.6rem]"
            >
              {t.title}
            </h2>
            <p className="mt-3 max-w-[34rem] text-[0.92rem] leading-[1.6] text-ink-2">{t.body}</p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <span className={pill}>
                <Scales className="h-4 w-4" />
                AGPL-3.0
              </span>
              <a href={`${site.githubUrl}/blob/main/LICENSE`} rel="noopener" className={pill}>
                <GhMark className="h-4 w-4" />
                {t.license}
              </a>
            </div>
            <a
              href={site.githubUrl}
              rel="noopener"
              className="mt-5 inline-flex h-12 items-center gap-2.5 rounded-full bg-accent px-6 text-[0.95rem] font-semibold text-accent-ink"
            >
              <GhMark className="h-5 w-5" />
              {t.cta}
              <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
            </a>
          </div>
          <div aria-hidden="true" className="hidden h-full w-px bg-divider xl:block" />
          <ul className="space-y-3.5">
            {t.points.map((p, i) => {
              const Icon = ICONS[i];
              return (
                <li key={p.title} className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-wash text-accent">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-[0.95rem] font-bold text-ink">{p.title}</h3>
                    <p className="mt-0.5 text-[0.85rem] leading-[1.5] text-ink-2">{p.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <Illustration />
        </div>
      </div>
    </section>
  );
}
