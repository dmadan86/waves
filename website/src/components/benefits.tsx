import type { Dictionary } from '@/i18n/dictionaries';
import { Check, CloudOff, Mic } from './icons';
import { Kicker } from './ui';

const LANGS = ['English', 'हिन्दी', 'தமிழ்', 'العربية', 'Hinglish'];

/** Small product visuals, drawn in CSS: a voice line, a receipt, an offline save. */
function VoiceVisual({ say }: { say: string }) {
  return (
    <div aria-hidden="true">
      <div className="flex items-center gap-2.5 rounded-2xl bg-chip p-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#FF7A59] text-white">
          <Mic className="h-4 w-4" />
        </span>
        <p className="min-w-0 text-[0.86rem] font-medium text-ink">“{say}”</p>
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {LANGS.map((l) => (
          <li
            key={l}
            className="rounded-full bg-accent-wash px-2.5 py-1 text-[0.74rem] font-medium text-accent"
          >
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReceiptVisual({ v, total }: { v: Dictionary['benefits']['visual']; total: string }) {
  const rows = ['62%', '48%', '70%', '54%'];
  return (
    <div aria-hidden="true" className="flex items-center gap-3">
      <div className="w-[7.5rem] shrink-0 rounded-lg bg-white p-2.5 shadow-[var(--w-shadow-md)] [transform:rotate(-2deg)]">
        <p className="font-mono text-[0.62rem] tracking-wide text-[#5B546F] uppercase rtl:tracking-normal">
          {v.receipt}
        </p>
        {rows.map((w) => (
          <div key={w} className="mt-1.5 flex items-center justify-between gap-1">
            <i className="block h-1.5 rounded-full bg-[#D9D4F5]" style={{ width: w }} />
            <i className="block h-1.5 w-3 rounded-full bg-[#C4B5FD]" />
          </div>
        ))}
        <p className="mt-2 border-t border-dashed border-[#C5BFD7] pt-1.5 text-end font-mono text-[0.8rem] font-medium text-[#1B1530]">
          {total}
        </p>
      </div>
      <p className="inline-flex items-center gap-1.5 rounded-full bg-[#D1FAE5] px-2.5 py-1 text-[0.76rem] font-medium text-[#047857]">
        <Check className="h-3 w-3" />
        {v.scanned}
      </p>
    </div>
  );
}

function OfflineVisual({ v }: { v: Dictionary['benefits']['visual'] }) {
  return (
    <div aria-hidden="true" className="space-y-2">
      <p className="inline-flex items-center gap-1.5 rounded-full bg-chip px-2.5 py-1 text-[0.76rem] font-medium text-ink-2">
        <CloudOff className="h-3.5 w-3.5" />
        {v.offline}
      </p>
      <p className="rounded-xl bg-chip px-3 py-2 text-[0.84rem] font-medium text-ink">{v.saved}</p>
      <p className="inline-flex items-center gap-1.5 text-[0.8rem] font-semibold text-up">
        <Check className="h-3.5 w-3.5" />
        {v.synced}
      </p>
    </div>
  );
}

export function Benefits({
  t,
  say,
  total,
}: {
  t: Dictionary['benefits'];
  say: string;
  total: string;
}) {
  const visuals = [
    <VoiceVisual key="v" say={say} />,
    <ReceiptVisual key="r" v={t.visual} total={total} />,
    <OfflineVisual key="o" v={t.visual} />,
  ];
  return (
    <section id="why" aria-labelledby="why-title" className="on-light scroll-mt-20 py-12 lg:py-16">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <Kicker>{t.eyebrow}</Kicker>
        <h2
          id="why-title"
          className="display mt-2 text-balance text-[2.1rem] text-ink sm:text-[3rem]"
        >
          {t.title}
        </h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {t.items.map((item, i) => (
            <li
              key={item.title}
              className="flex flex-col rounded-[1.4rem] bg-surface p-5 shadow-[var(--w-shadow-card)]"
            >
              <h3 className="text-[1.2rem] leading-tight font-bold text-ink">{item.title}</h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-2">{item.body}</p>
              <div className="mt-auto pt-5">{visuals[i]}</div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
