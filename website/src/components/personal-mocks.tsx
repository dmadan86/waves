import type { Dictionary } from '@/i18n/dictionaries';
import './companies.css';
import './personal.css';
import { InView } from './in-view';

type M = Dictionary['personalMock'];

/**
 * Small drawn product mock-ups for the personal page. Same contract as
 * company-mocks.tsx: live DOM (translatable), decorative (the copy beside each
 * says the same in words, so aria-hidden), and the markup is the finished state.
 * Motion lives in personal.css / companies.css.
 */

const shell = 'rounded-2xl bg-surface p-4 shadow-[var(--w-shadow-card)]';
const label =
  'text-[0.75rem] font-semibold tracking-[0.1em] rtl:tracking-normal text-ink-3 uppercase';
const amt = 'text-[0.88rem] font-semibold text-ink tabular-nums';
const idx = (i: number) => ({ '--i': i }) as React.CSSProperties;

function Tick({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        className="cm-tick"
        pathLength={24}
        d="M5 12.5l4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Bar({ pct, i = 0, className = '' }: { pct: number; i?: number; className?: string }) {
  return (
    <span className={`block h-2 overflow-hidden rounded-full bg-chip ${className}`}>
      <span
        className="pm-bar block h-full rounded-full bg-accent"
        style={{ width: `${pct}%`, ...idx(i) }}
      />
    </span>
  );
}

/** A bank message arrives, becomes a Food expense, and the Food budget bar fills. */
export function PersonalDemo({ m, className = '' }: { m: M; className?: string }) {
  const d = m.demo;
  return (
    <InView loop className={className}>
      <div aria-hidden="true" className={`${shell} mx-auto w-full max-w-[24rem]`}>
        <div className="flex items-center justify-between">
          <p className={label}>{d.title}</p>
          <span className="rounded-full bg-accent-wash px-2.5 py-0.5 text-[0.72rem] font-semibold text-accent">
            {d.month}
          </span>
        </div>
        <div className="relative mt-3 h-[8.5rem]">
          <div className="pm-l-sms absolute inset-x-0 top-0 rounded-xl bg-chip px-3 py-2.5">
            <p className="text-[0.7rem] font-semibold text-ink-3">{d.bank}</p>
            <bdi className="mt-1 block text-[0.84rem] leading-[1.4] text-ink">{d.sms}</bdi>
          </div>
          <div className="pm-l-row absolute inset-x-0 top-0 flex h-14 items-center gap-3 rounded-xl bg-chip px-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-wash text-[1.1rem]">
              🍔
            </span>
            <div className="min-w-0 flex-1">
              <bdi className="block truncate text-[0.88rem] font-medium text-ink">{d.item}</bdi>
              <span className="pm-l-tag block text-[0.72rem] text-accent">{d.added}</span>
            </div>
            <bdi className={amt}>₹450</bdi>
          </div>
          <div className="absolute inset-x-0 bottom-0">
            <div className="flex items-center justify-between text-[0.82rem]">
              <span className="text-ink-2">{d.budget}</span>
              <span className="relative block h-5 w-[5.4rem] overflow-hidden text-end">
                <bdi className="pm-l-old absolute inset-0 text-[0.88rem] font-bold text-ink tabular-nums">
                  ₹3,300
                </bdi>
                <bdi className="pm-l-new absolute inset-0 text-[0.88rem] font-bold text-ink tabular-nums">
                  ₹3,750
                </bdi>
              </span>
            </div>
            <span className="mt-2 block h-2.5 overflow-hidden rounded-full bg-chip">
              <span className="pm-l-bar pm-bar block h-full w-[62%] rounded-full bg-accent" />
            </span>
            <p className="mt-1.5 text-[0.74rem] text-ink-3">
              <bdi>{d.of}</bdi>
            </p>
          </div>
        </div>
      </div>
    </InView>
  );
}

export function SpendingMock({ m }: { m: M }) {
  const s = m.spending;
  const pct = [100, 65, 47, 39];
  return (
    <InView>
      <div aria-hidden="true" className={shell}>
        <div className="flex items-center justify-between">
          <p className={label}>{s.title}</p>
          <bdi className="flex text-[1.1rem] font-bold text-ink tabular-nums">
            ₹<span className="cm-num" style={{ '--a': 24, '--b': 600 } as React.CSSProperties} />
          </bdi>
        </div>
        <ul className="mt-3 space-y-2.5">
          {s.cats.map((c, i) => (
            <li key={c.name}>
              <div className="flex justify-between text-[0.82rem]">
                <span className="text-ink-2">{c.name}</span>
                <bdi className="font-semibold text-ink tabular-nums">{c.amount}</bdi>
              </div>
              <Bar pct={pct[i]} i={i} className="mt-1" />
            </li>
          ))}
        </ul>
      </div>
    </InView>
  );
}

export function BudgetMock({ m }: { m: M }) {
  const b = m.budgets;
  return (
    <InView>
      <div aria-hidden="true" className={shell}>
        <p className={label}>{b.title}</p>
        <ul className="mt-3 space-y-3">
          {b.items.map((it, i) => (
            <li key={it.name}>
              <div className="flex items-baseline justify-between text-[0.82rem]">
                <span className="text-ink-2">{it.name}</span>
                <bdi className="text-ink-3 tabular-nums">{it.of}</bdi>
              </div>
              <Bar pct={it.pct} i={i} className="mt-1 h-2.5" />
              <p className="mt-1 text-[0.74rem] text-ink-3">
                <bdi>{it.left}</bdi>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </InView>
  );
}

export function LoanMock({ m }: { m: M }) {
  const l = m.loans;
  return (
    <InView>
      <div aria-hidden="true" className={shell}>
        <p className={label}>{l.title}</p>
        <ul className="mt-3 space-y-2">
          {l.items.map((it, i) => (
            <li key={it.name} className="cm-slide rounded-xl bg-chip px-3 py-2.5" style={idx(i)}>
              <div className="flex items-center justify-between gap-2">
                <bdi className="truncate text-[0.88rem] font-medium text-ink">{it.name}</bdi>
                <bdi className={amt}>{it.amount}</bdi>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[0.72rem]">
                <span className={i === 0 ? 'font-semibold text-accent' : 'text-ink-3'}>
                  {it.dir}
                </span>
                <bdi className="text-ink-3">{it.note}</bdi>
              </div>
              <Bar pct={it.pct} i={i + 1} className="mt-1.5 h-1.5" />
            </li>
          ))}
        </ul>
      </div>
    </InView>
  );
}

export function RecurringMock({ m }: { m: M }) {
  const r = m.recurring;
  return (
    <InView>
      <div aria-hidden="true" className={shell}>
        <p className={label}>{r.title}</p>
        <ul className="mt-3 space-y-2">
          {r.items.map((it, i) => (
            <li
              key={it.name}
              className="cm-slide flex h-12 items-center gap-3 rounded-xl bg-chip px-3"
              style={idx(i)}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-wash text-[0.95rem]">
                {it.icon}
              </span>
              <div className="min-w-0 flex-1">
                <bdi className="block truncate text-[0.86rem] font-medium text-ink">{it.name}</bdi>
                <bdi className="block text-[0.7rem] text-ink-3">{it.when}</bdi>
              </div>
              <bdi className={amt}>{it.amount}</bdi>
            </li>
          ))}
        </ul>
      </div>
    </InView>
  );
}

export function TransactionsMock({ m }: { m: M }) {
  const t = m.transactions;
  return (
    <InView>
      <div aria-hidden="true" className={shell}>
        <p className={label}>{t.title}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {t.tabs.map((s, i) => (
            <li
              key={s}
              className={`cm-pop rounded-full px-3 py-1 text-[0.74rem] font-semibold ${
                i === 0 ? 'bg-accent text-accent-ink' : 'bg-chip text-ink-2'
              }`}
              style={idx(i)}
            >
              <bdi>{s}</bdi>
            </li>
          ))}
        </ul>
        <ul className="mt-3 space-y-1.5">
          {t.rows.map((r, i) => (
            <li
              key={r.name}
              className="cm-slide flex items-center justify-between gap-2 text-[0.86rem]"
              style={idx(i + 2)}
            >
              <bdi className="min-w-0 truncate text-ink-2">{r.name}</bdi>
              <bdi className={`${amt} ${r.income ? 'text-accent' : ''}`}>{r.amount}</bdi>
            </li>
          ))}
        </ul>
      </div>
    </InView>
  );
}

export function SmsMock({ m }: { m: M }) {
  const s = m.sms;
  return (
    <InView>
      <div aria-hidden="true" className={shell}>
        <div className="pm-bubble rounded-xl bg-chip px-3 py-2.5">
          <p className="text-[0.7rem] font-semibold text-ink-3">{s.bank}</p>
          <bdi className="mt-1 block text-[0.84rem] leading-[1.4] text-ink">{s.text}</bdi>
        </div>
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {s.fields.map((f, i) => (
            <li key={f.k} className="pm-field rounded-lg bg-accent-wash px-2 py-1.5" style={idx(i)}>
              <p className="text-[0.66rem] font-semibold text-ink-3">{f.k}</p>
              <bdi className="block truncate text-[0.82rem] font-semibold text-ink">{f.v}</bdi>
            </li>
          ))}
        </ul>
        <span className="mt-3 inline-flex h-9 items-center rounded-full bg-accent px-4 text-[0.82rem] font-semibold text-accent-ink">
          {s.save}
        </span>
      </div>
    </InView>
  );
}

export function StatementMock({ m }: { m: M }) {
  const s = m.statement;
  return (
    <InView>
      <div aria-hidden="true" className={shell}>
        <div className="flex items-center justify-between">
          <p className={label}>{s.title}</p>
          <span className="rounded-full bg-accent-wash px-2.5 py-0.5 text-[0.72rem] font-semibold text-accent">
            <bdi>{s.count}</bdi>
          </span>
        </div>
        <ul className="mt-3 space-y-1.5">
          {s.rows.map((r, i) => (
            <li
              key={r.name}
              className="pm-tickrow flex items-center gap-2.5 text-[0.84rem]"
              style={idx(i)}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ${
                  r.credit ? 'bg-chip ring-1 ring-line' : 'bg-accent text-accent-ink'
                }`}
              >
                {r.credit ? null : <Tick className="h-3.5 w-3.5" />}
              </span>
              <bdi className="min-w-0 flex-1 truncate text-ink-2">{r.name}</bdi>
              <bdi className={amt}>{r.amount}</bdi>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line/70 pt-3 text-[0.8rem] text-ink-2">{s.note}</p>
      </div>
    </InView>
  );
}

export function VoiceMock({ m }: { m: M }) {
  const v = m.voice;
  const h = [40, 75, 55, 95, 65, 85, 45, 70, 35, 60, 80, 50];
  return (
    <InView>
      <div aria-hidden="true" className={shell}>
        <div className="flex h-10 items-center justify-center gap-1">
          {h.map((n, i) => (
            <span
              key={i}
              className="pm-wave block w-1 rounded-full bg-accent"
              style={{ height: `${n}%`, ...idx(i) }}
            />
          ))}
        </div>
        <bdi className="mt-2 block text-center text-[0.9rem] font-medium text-ink">“{v.said}”</bdi>
        <div className="pm-field mt-3 flex items-center justify-between rounded-xl bg-chip px-3 py-2.5">
          <div className="min-w-0">
            <bdi className="block truncate text-[0.88rem] font-medium text-ink">{v.item}</bdi>
            <bdi className="block text-[0.72rem] text-accent">{v.cat}</bdi>
          </div>
          <bdi className={amt}>₹80</bdi>
        </div>
      </div>
    </InView>
  );
}

export function ReceiptMock({ m }: { m: M }) {
  const r = m.receipt;
  return (
    <InView>
      <div aria-hidden="true" className={`${shell} flex gap-4`}>
        <div className="pm-bubble relative h-[8.5rem] w-[6.5rem] shrink-0 overflow-hidden rounded-lg bg-white p-2 ring-1 ring-line">
          {[70, 90, 55, 80, 60].map((w, i) => (
            <span
              key={i}
              className="mb-1.5 block h-1.5 rounded-full bg-[#d9d6ee]"
              style={{ width: `${w}%` }}
            />
          ))}
          <span className="absolute inset-x-1 bottom-2 block h-2 rounded-full bg-[#14142b]/80" />
        </div>
        <ul className="min-w-0 flex-1 space-y-2">
          {r.fields.map((f, i) => (
            <li key={f.k} className="pm-field rounded-lg bg-chip px-2.5 py-1.5" style={idx(i)}>
              <p className="text-[0.66rem] font-semibold text-ink-3">{f.k}</p>
              <bdi className="block truncate text-[0.84rem] font-semibold text-ink">{f.v}</bdi>
            </li>
          ))}
        </ul>
      </div>
    </InView>
  );
}
