import type { ReactNode } from 'react';

import { Icon } from './icons';

/**
 * The console's component vocabulary.
 *
 * Every screen here was previously hand-assembled out of `<section>` and a
 * className, which is how the same idea — "a card with a title", "this went
 * wrong", "there is nothing here yet" — ended up drawn five slightly different
 * ways. These are the shapes the reference dashboard has, named once.
 *
 * All Server Components: none of them holds state, so none of them needs to
 * cross onto the client and drag a page's data fetching with it.
 */

/* ── page header ───────────────────────────────────────────────────────── */

/**
 * The reference's page head: a small uppercase eyebrow naming the section, the
 * title under it, and any page-level actions pushed to the right.
 */
export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  );
}

/** The standing paragraph of explanation under a page title. */
export function Lede({ children }: { children: ReactNode }) {
  return <p className="lede">{children}</p>;
}

/* ── card ──────────────────────────────────────────────────────────────── */

export function Card({
  title,
  eyebrow,
  actions,
  note,
  bare,
  children,
}: {
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  /** Small print under the content — the caveat a number needs to be read with. */
  note?: ReactNode;
  /** Skip the inner padding, for a card whose whole body is a table. */
  bare?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="card">
      {title ? (
        <div className="card-head">
          <div>
            {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
            <h3>{title}</h3>
          </div>
          {actions ? <div className="actions row">{actions}</div> : null}
        </div>
      ) : null}
      {children ? bare ? children : <div className="card-body">{children}</div> : null}
      {note ? <p className="card-note">{note}</p> : null}
    </section>
  );
}

/* ── figures ───────────────────────────────────────────────────────────── */

/**
 * The reference's stat card: label over value, glyph on the right, no shadow.
 * `sub` carries the comparison — "+12 in 7d" — and `dir` colours it, because a
 * movement with no direction is just another number.
 */
export function Stat({
  label,
  value,
  sub,
  dir = 'flat',
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  dir?: 'up' | 'down' | 'flat';
  icon: ReactNode;
}) {
  return (
    <div className="stat">
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub ? <div className={`stat-sub ${dir}`}>{sub}</div> : null}
      </div>
      {icon}
    </div>
  );
}

/** A quieter figure, for the count row above a list. */
export function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <div className="tile-value">{value}</div>
      {sub ? <div className="tile-sub">{sub}</div> : null}
    </div>
  );
}

/* ── badge ─────────────────────────────────────────────────────────────── */

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const TONE_CLASS: Record<Tone, string> = {
  neutral: '',
  accent: ' badge-accent',
  ok: ' badge-ok',
  warn: ' badge-warn',
  danger: ' badge-danger',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge${TONE_CLASS[tone]}`}>{children}</span>;
}

/** A live/off state, which is a light rather than a label. */
export function Dot({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className="row" style={{ gap: 0 }}>
      <span className={on ? 'dot on' : 'dot off'} aria-hidden />
      {children}
    </span>
  );
}

/* ── banners ───────────────────────────────────────────────────────────── */

/**
 * The outcome of the action you just took.
 *
 * Every mutation in this console redirects with `?error=` or `?saved=`, so by
 * the time one of these renders the whole document has been replaced. That is
 * why the live region is `polite` and not `alert`: the page change is itself
 * the interruption, and a second one on top of it is noise. `role="status"`
 * gives a screen reader the sentence without stealing focus from wherever the
 * operator was heading next.
 */
export function Banner({
  tone,
  children,
}: {
  tone: 'ok' | 'danger' | 'info';
  children: ReactNode;
}) {
  const glyph = tone === 'ok' ? Icon.ok : tone === 'danger' ? Icon.alert : Icon.info;
  return (
    <div className={`banner banner-${tone}`} role="status" aria-live="polite">
      {glyph}
      <div>{children}</div>
    </div>
  );
}

/** The two query params every mutating page in here redirects with. */
export function Outcome({ error, done }: { error?: string; done?: string }) {
  return (
    <>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {done ? <Banner tone="ok">{done}</Banner> : null}
    </>
  );
}

/* ── empty state ───────────────────────────────────────────────────────── */

/**
 * Nothing here — and, importantly, *why*.
 *
 * This console runs against projects at different migration levels, so "no
 * rows" and "that table does not exist here yet" look identical from the
 * outside and mean completely different things. `migration` names the one that
 * would create the rows, so a first-run state reads as a first-run state
 * instead of as a broken screen.
 */
export function Empty({
  title,
  children,
  migration,
}: {
  title: string;
  children?: ReactNode;
  migration?: string;
}) {
  return (
    <div className="empty">
      {Icon.empty}
      <div className="empty-title">{title}</div>
      {children ? <p>{children}</p> : null}
      {migration ? (
        <p>
          If you expected some, the <code>{migration}</code> migration may not be deployed to this
          project.
        </p>
      ) : null}
    </div>
  );
}

/* ── table ─────────────────────────────────────────────────────────────── */

/**
 * A table that scrolls inside its own box rather than pushing the page
 * sideways. Desktop-only does not mean "assume 4K": a fourteen-column table
 * still overflows a laptop, and the fix is a scroll container, not a smaller
 * font.
 */
export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="table-scroll">{children}</div>;
}

/* ── forms ─────────────────────────────────────────────────────────────── */

/**
 * A labelled control.
 *
 * The `<label>` wraps its input, so the association needs no id and cannot
 * drift — which matters here because most of these forms are generated from
 * rows and would otherwise need a unique id per row per field.
 */
export function Field({
  label,
  hint,
  children,
  full,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={full ? 'field form-full' : 'field'}>
      <span>
        {label}
        {hint ? <span className="field-hint"> — {hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

/** A checkbox with its words beside it rather than above. */
export function Check({
  name,
  label,
  defaultChecked,
  plain,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  plain?: boolean;
}) {
  return (
    <label className={plain ? 'check plain' : 'check'}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}

/* ── skeleton ──────────────────────────────────────────────────────────── */

/**
 * What a route's `loading.tsx` shows while its server component is still
 * talking to Postgres. Shaped like the page it precedes — a header, a row of
 * figures, a slab where the table goes — so the layout does not jump when the
 * data lands.
 */
export function PageSkeleton({ figures = 4, rows = 6 }: { figures?: number; rows?: number }) {
  return (
    <main className="page" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading.</span>
      <div className="page-head">
        <div>
          <div className="skel skel-line" style={{ width: 90, marginBottom: 8 }} />
          <div className="skel" style={{ width: 220, height: 22 }} />
        </div>
      </div>
      {figures > 0 ? (
        <div className="autofit" style={{ marginBottom: '1rem' }}>
          {Array.from({ length: figures }, (_, i) => (
            <div className="tile" key={i}>
              <div className="skel skel-line" style={{ width: '55%', marginBottom: 10 }} />
              <div className="skel" style={{ width: '35%', height: 20 }} />
            </div>
          ))}
        </div>
      ) : null}
      <div className="card">
        <div className="card-body">
          {Array.from({ length: rows }, (_, i) => (
            <div
              className="skel skel-line"
              key={i}
              style={{ width: `${92 - (i % 4) * 11}%`, marginBottom: 12 }}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
