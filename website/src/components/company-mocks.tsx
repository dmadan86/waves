import type { Dictionary } from '@/i18n/dictionaries';
import './companies.css';
import { InView } from './in-view';

type M = Dictionary['companyMock'];

/**
 * Small drawn product mock-ups for the companies page. Like the other drawn
 * visuals they are live DOM (translatable, no 400 KB PNG) and decorative: the
 * copy beside each one says the same thing in words, so they are aria-hidden.
 * Motion lives in companies.css; the markup here is the finished state.
 */

const shell = 'rounded-2xl bg-surface p-4 shadow-[var(--w-shadow-card)]';
const label =
  'text-[0.75rem] font-semibold tracking-[0.1em] rtl:tracking-normal text-ink-3 uppercase';

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

function Thumb() {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-wash text-accent">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
      >
        <path d="M4 8h3l1.5-2h7L17 8h3v11H4zM12 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      </svg>
    </span>
  );
}

/** An expense lands in the queue, is approved, and the balance ticks to its new value. */
export function ApprovalDemo({ m, className = '' }: { m: M; className?: string }) {
  return (
    <InView loop className={className}>
      <div aria-hidden="true" className={`cm-loop ${shell} mx-auto w-full max-w-[24rem]`}>
        <div className="flex items-center justify-between">
          <p className={label}>{m.title}</p>
          <span className="rounded-full bg-accent-wash px-2.5 py-0.5 text-[0.72rem] font-semibold text-accent">
            {m.who}
          </span>
        </div>
        <ul className="mt-3 space-y-2">
          <li className="flex h-14 items-center gap-3 rounded-xl bg-chip px-3">
            <Thumb />
            <bdi className="min-w-0 flex-1 truncate text-[0.88rem] font-medium text-ink">
              {m.item2}
            </bdi>
            <bdi className="text-[0.88rem] font-semibold text-ink tabular-nums">₹1,200</bdi>
            <Tick className="h-4 w-4 text-accent" />
          </li>
          <li className="cm-loop-row flex h-14 items-center gap-3 rounded-xl bg-chip px-3">
            <Thumb />
            <bdi className="min-w-0 flex-1 truncate text-[0.88rem] font-medium text-ink">
              {m.item}
            </bdi>
            <bdi className="text-[0.88rem] font-semibold text-ink tabular-nums">₹850</bdi>
            <span className="relative block h-7 w-[5.2rem] shrink-0">
              <span className="cm-wait absolute inset-0 grid place-items-center rounded-full bg-surface text-[0.72rem] font-semibold text-ink-2 ring-1 ring-line">
                {m.waiting}
              </span>
              <span className="cm-ok absolute inset-0 inline-flex items-center justify-center gap-1 rounded-full bg-accent text-[0.72rem] font-semibold text-accent-ink">
                <Tick />
                {m.approved}
              </span>
            </span>
          </li>
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-line/70 pt-3">
          <p className="text-[0.82rem] text-ink-2">{m.balance}</p>
          <span className="relative block h-6 w-[4.6rem] overflow-hidden text-end">
            <bdi className="cm-new-old absolute inset-0 text-[1rem] font-bold text-ink tabular-nums">
              ₹1,200
            </bdi>
            <bdi className="cm-new-new absolute inset-0 text-[1rem] font-bold text-ink tabular-nums">
              ₹2,050
            </bdi>
          </span>
        </div>
      </div>
    </InView>
  );
}

export function ApproveMock({ m }: { m: M }) {
  return (
    <InView>
      <div aria-hidden="true" className={`cm-once ${shell}`}>
        <div className="flex items-center gap-3">
          <Thumb />
          <div className="min-w-0 flex-1">
            <bdi className="block truncate text-[0.9rem] font-semibold text-ink">{m.item}</bdi>
            <bdi className="block text-[0.78rem] text-ink-3">{m.who}</bdi>
          </div>
          <bdi className="text-[1rem] font-bold text-ink tabular-nums">₹850</bdi>
        </div>
        <span className="cm-press mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[0.82rem] font-semibold text-accent-ink">
          <Tick />
          {m.approve}
        </span>
      </div>
    </InView>
  );
}

export function AllowanceMock({ m }: { m: M }) {
  const a = m.allowance;
  return (
    <InView>
      <div aria-hidden="true" className={shell}>
        <p className={label}>{a.title}</p>
        <div className="mt-3 flex items-center justify-between text-[0.9rem]">
          <span className="text-ink-2">{a.days}</span>
          <bdi className="font-semibold text-ink tabular-nums">6 × ₹700</bdi>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-line/70 pt-3">
          <span className="text-[0.82rem] text-ink-2">{a.total}</span>
          <bdi className="flex text-[1.1rem] font-bold text-ink tabular-nums">
            ₹<span className="cm-num" style={{ '--a': 4, '--b': 200 } as React.CSSProperties} />
          </bdi>
        </div>
      </div>
    </InView>
  );
}

export function WagesMock({ m }: { m: M }) {
  const w = m.wages;
  return (
    <InView>
      <div aria-hidden="true" className={shell}>
        <p className={label}>{w.title}</p>
        <ul className="mt-3 flex justify-between">
          {w.days.map((d, i) => (
            <li key={d} className="flex flex-col items-center gap-1.5">
              <span
                className={`cm-pop grid h-8 w-8 place-items-center rounded-full text-[0.7rem] font-semibold ${
                  i === 5 ? 'bg-chip text-ink-3' : 'bg-accent text-accent-ink'
                }`}
                style={{ '--i': i } as React.CSSProperties}
              >
                {i === 5 ? '½' : '✓'}
              </span>
              <span className="text-[0.68rem] text-ink-3">{d}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-line/70 pt-3">
          <span className="text-[0.82rem] text-ink-2">{w.total}</span>
          <bdi className="flex text-[1.1rem] font-bold text-ink tabular-nums">
            ₹<span className="cm-num" style={{ '--a': 18, '--b': 200 } as React.CSSProperties} />
          </bdi>
        </div>
        <span className="mt-3 inline-flex h-9 items-center rounded-full bg-accent px-4 text-[0.82rem] font-semibold text-accent-ink">
          {w.record}
        </span>
      </div>
    </InView>
  );
}

const QR = '1110111010101110101011101000101111011011001010011'; // 7x7, drawn, not scannable

export function BillMock({ m }: { m: M }) {
  const b = m.bills;
  return (
    <InView>
      <div aria-hidden="true" className={`${shell} flex gap-4`}>
        <div className="min-w-0 flex-1">
          <p className={label}>{b.title}</p>
          <ul className="mt-3 space-y-1.5 text-[0.86rem]">
            {[
              [b.line1, '₹3,000'],
              [b.line2, '₹1,500'],
            ].map(([k, v], i) => (
              <li
                key={k}
                className="cm-slide flex justify-between gap-2"
                style={{ '--i': i } as React.CSSProperties}
              >
                <bdi className="truncate text-ink-2">{k}</bdi>
                <bdi className="font-semibold text-ink tabular-nums">{v}</bdi>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-line/70 pt-2">
            <span className="text-[0.82rem] text-ink-2">{b.total}</span>
            <bdi className="flex text-[1.05rem] font-bold text-ink tabular-nums">
              ₹<span className="cm-num" style={{ '--a': 4, '--b': 500 } as React.CSSProperties} />
            </bdi>
          </div>
        </div>
        <div className="cm-slide shrink-0 text-center" style={{ '--i': 3 } as React.CSSProperties}>
          <div className="grid h-[4.4rem] w-[4.4rem] grid-cols-7 gap-px rounded-md bg-white p-1.5 ring-1 ring-line">
            {QR.split('').map((c, i) => (
              <span key={i} className={c === '1' ? 'bg-[#14142b]' : 'bg-transparent'} />
            ))}
          </div>
          <p className="mt-1 text-[0.66rem] font-semibold text-ink-3">{b.scan}</p>
        </div>
      </div>
    </InView>
  );
}

export function TicketMock({ m }: { m: M }) {
  const t = m.tickets;
  return (
    <InView>
      <div aria-hidden="true" className={`${shell} cm-flip`}>
        <p className={label}>{t.title}</p>
        <ul className="mt-3 grid grid-cols-3 gap-1 text-center text-[0.72rem] font-semibold text-ink-3">
          {[t.open, t.progress, t.resolved].map((c) => (
            <li key={c} className="rounded-md bg-chip py-1">
              {c}
            </li>
          ))}
        </ul>
        <div className="mt-2 grid h-14 grid-cols-3 gap-1">
          <div className="cm-ticket flex items-center justify-center rounded-lg bg-accent px-1 text-center text-[0.76rem] font-semibold text-accent-ink">
            <bdi className="truncate">{t.ticket}</bdi>
          </div>
        </div>
      </div>
    </InView>
  );
}

// P present, H half day, A absent, L leave, . not yet / weekend: a 5-week month.
const MONTH = 'PPPPP..PPPPH..PPPPPA..PPLLP..PPHPP';

export function AttendanceMock({ m }: { m: M }) {
  const a = m.attendance;
  const cell = (c: string) =>
    c === 'P'
      ? 'bg-accent'
      : c === 'H'
        ? 'bg-accent-wash ring-1 ring-accent'
        : c === 'A'
          ? 'bg-chip ring-1 ring-line'
          : c === 'L'
            ? 'bg-surface ring-1 ring-ink-3'
            : 'bg-transparent';
  return (
    <InView>
      <div aria-hidden="true" className={shell}>
        <div className="flex items-center justify-between">
          <p className={label}>{a.title}</p>
          <span className="rounded-full bg-accent-wash px-2.5 py-0.5 text-[0.72rem] font-semibold text-accent">
            <bdi>{a.count}</bdi>
          </span>
        </div>
        <ul className="mt-3 grid grid-cols-7 gap-1.5">
          {MONTH.split('').map((c, i) => (
            <li
              key={i}
              className={`cm-fill h-5 rounded-md ${cell(c)}`}
              style={{ '--i': i } as React.CSSProperties}
            />
          ))}
        </ul>
        <p className="mt-3 border-t border-line/70 pt-3 text-[0.82rem] text-ink-2">{a.today}</p>
      </div>
    </InView>
  );
}

export function TaskMock({ m }: { m: M }) {
  const t = m.tasks;
  return (
    <InView>
      <div aria-hidden="true" className={`${shell} cm-flip`}>
        <p className={label}>{t.title}</p>
        <ul className="mt-3 grid grid-cols-3 gap-1 text-center text-[0.72rem] font-semibold text-ink-3">
          {[t.todo, t.doing, t.done].map((c) => (
            <li key={c} className="rounded-md bg-chip py-1">
              {c}
            </li>
          ))}
        </ul>
        <div className="mt-2 grid h-[4.2rem] grid-cols-3 gap-1">
          <div className="cm-task flex flex-col justify-center rounded-lg bg-accent px-1.5 text-center text-accent-ink">
            <bdi className="truncate text-[0.74rem] font-semibold">#12 {t.task}</bdi>
            <bdi className="truncate text-[0.66rem] opacity-80">{t.site}</bdi>
          </div>
        </div>
      </div>
    </InView>
  );
}
