'use client';

/** The Tasks screen's pieces: stat tiles, month calendar, empty art and the "Assign to people" dialog. */
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarCheck,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Search,
  Users,
} from 'lucide-react';

import { memberName, type CompanyMember } from '@/lib/company/view';
import { workStrings as s } from '@/lib/company/workStrings';
import { MAX_TASK_HELPERS } from '@/lib/company/workTasks';

const disc = (ink: string, size: number): React.CSSProperties => ({
  display: 'grid',
  placeItems: 'center',
  width: size,
  height: size,
  borderRadius: 999,
  flex: 'none',
  color: ink,
  background: `color-mix(in srgb, ${ink} 14%, transparent)`,
});

const NEG = 'var(--w-negative)';

export function StatTiles({
  all,
  overdue,
  dueToday,
  completed,
}: {
  all: number;
  overdue: number;
  dueToday: number;
  completed: number;
}) {
  const tiles = [
    { n: all, label: s.allTasks, icon: <CheckSquare size={16} />, ink: 'var(--w-brand)' },
    { n: overdue, label: s.overdue, icon: <AlertCircle size={16} />, ink: NEG },
    { n: dueToday, label: s.dueToday, icon: <CalendarCheck size={16} />, ink: 'var(--w-warning)' },
    { n: completed, label: s.completed, icon: <CheckCircle2 size={16} />, ink: '#16a34a' },
  ];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 8,
        margin: '10px 0',
      }}
    >
      {tiles.map((t) => (
        <div
          key={t.label}
          role="group"
          aria-label={`${t.label}: ${t.n}`}
          className="card"
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10 }}
        >
          <span style={disc(t.ink, 32)}>{t.icon}</span>
          <span style={{ minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: 'var(--w-font-heading)' }}>{t.n}</strong>
            <small style={{ color: 'var(--w-text-muted)' }}>{t.label}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

/** A month of days: Sun and Sat in red, a dot where a task is due, solid selected day, ring for today. */
export function TaskMonth({
  days,
  today,
  selected,
  onSelect,
}: {
  /** ISO days that have a task. */
  days: ReadonlySet<string>;
  today: string;
  selected: string | null;
  onSelect: (day: string | null) => void;
}) {
  const [ym, setYm] = useState(() => ({
    y: Number(today.slice(0, 4)),
    m: Number(today.slice(5, 7)),
  }));
  const first = new Date(Date.UTC(ym.y, ym.m - 1, 1));
  const count = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const move = (by: number) => {
    const n = new Date(Date.UTC(ym.y, ym.m - 1 + by, 1));
    setYm({ y: n.getUTCFullYear(), m: n.getUTCMonth() + 1 });
  };
  const wd = (i: number) =>
    new Date(Date.UTC(2026, 0, 4 + i)).toLocaleDateString(undefined, {
      weekday: 'short',
      timeZone: 'UTC',
    });
  return (
    <div className="card" style={{ padding: 10, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          type="button"
          className="btn ghost"
          aria-label={s.prevMonth}
          onClick={() => move(-1)}
        >
          <ChevronLeft size={16} />
        </button>
        <strong>
          {first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}
        </strong>
        <button
          type="button"
          className="btn ghost"
          aria-label={s.nextMonth}
          onClick={() => move(1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center' }}>
        {Array.from({ length: 7 }, (_, i) => (
          <small
            key={i}
            style={{ color: i === 0 || i === 6 ? NEG : 'var(--w-text-muted)', fontWeight: 600 }}
          >
            {wd(i)}
          </small>
        ))}
        {Array.from({ length: lead + count }, (_, i) => {
          const n = i - lead + 1;
          if (n < 1) return <span key={i} />;
          const day = `${ym.y}-${String(ym.m).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
          const on = day === selected;
          const weekend = i % 7 === 0 || i % 7 === 6;
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              aria-current={day === today ? 'date' : undefined}
              onClick={() => onSelect(on ? null : day)}
              style={{
                margin: '1px auto',
                width: 36,
                height: 36,
                borderRadius: 999,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 'var(--w-font-caption)',
                border: day === today && !on ? '2px solid var(--w-brand)' : '2px solid transparent',
                background: on ? 'var(--w-brand-solid)' : 'transparent',
                color: on ? 'var(--w-on-brand)' : weekend ? NEG : 'var(--w-text)',
              }}
            >
              {n}
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  background: days.has(day)
                    ? on
                      ? 'var(--w-on-brand)'
                      : 'var(--w-brand)'
                    : 'transparent',
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** An empty-state picture made of icons. */
export function EmptyTasksArt() {
  return (
    <span style={{ position: 'relative', ...disc('var(--w-brand)', 96) }} aria-hidden>
      <ClipboardList size={48} />
      <CheckSquare
        size={22}
        style={{ position: 'absolute', right: 8, bottom: 8, color: 'var(--w-brand-solid)' }}
      />
    </span>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** The people dialog: search, rows with a square checkbox, "N people selected · Clear", Assign (N) / Done. */
function HelpersDialog({
  people,
  value,
  onChange,
  onClose,
}: {
  people: readonly CompanyMember[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const needle = q.trim().toLowerCase();
  const list = people.filter((p) => !needle || memberName(p, '').toLowerCase().includes(needle));
  const full = value.length >= MAX_TASK_HELPERS;
  return (
    <dialog
      ref={ref}
      aria-labelledby="helpers-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      style={{
        width: 'min(420px, 92vw)',
        padding: 16,
        border: '1px solid var(--w-border)',
        borderRadius: 'var(--w-radius-xxl)',
        background: 'var(--w-surface)',
        color: 'var(--w-text)',
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
        <span style={disc('var(--w-brand)', 40)}>
          <Users size={20} />
        </span>
        <div>
          <h3 id="helpers-title" style={{ margin: 0 }}>
            {s.assignTitle}
          </h3>
          <small style={{ color: 'var(--w-text-muted)' }}>{s.helpersSubtitle}</small>
        </div>
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          border: '1px solid var(--w-border)',
          borderRadius: 'var(--w-radius-lg)',
        }}
      >
        <Search size={16} aria-hidden />
        <input
          type="search"
          aria-label={s.searchPeople}
          placeholder={s.searchPeople}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', minHeight: 40 }}
        />
      </label>
      <div style={{ maxHeight: 300, overflowY: 'auto', margin: '8px 0' }}>
        {list.map((p) => {
          const on = value.includes(p.id);
          const name = memberName(p, '');
          const blocked = !on && full;
          return (
            <button
              key={p.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={name}
              disabled={blocked}
              onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                minHeight: 48,
                padding: '4px 8px',
                border: 0,
                borderRadius: 'var(--w-radius-lg)',
                cursor: blocked ? 'default' : 'pointer',
                opacity: blocked ? 0.45 : 1,
                font: 'inherit',
                textAlign: 'start',
                color: 'inherit',
                background: on ? 'var(--w-brand-soft)' : 'transparent',
              }}
            >
              <span className="avatar">{initials(name)}</span>
              <strong style={{ flex: 1, minWidth: 0 }}>{name}</strong>
              <span
                aria-hidden
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: on ? 0 : '1.5px solid var(--w-text-muted)',
                  background: on ? 'var(--w-brand-solid)' : 'transparent',
                  color: 'var(--w-on-brand)',
                }}
              >
                {on ? <Check size={16} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      {value.length > 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 12px',
            marginBottom: 8,
            borderRadius: 'var(--w-radius-lg)',
            background: 'var(--w-brand-soft)',
          }}
        >
          <Users size={16} aria-hidden />
          <span style={{ flex: 1 }}>{s.peopleSelected.replace('{n}', String(value.length))}</span>
          <button type="button" className="btn ghost" onClick={() => onChange([])}>
            {s.clear}
          </button>
        </div>
      ) : null}
      <button type="button" className="btn brand block" onClick={onClose}>
        {value.length > 0 ? s.assignN.replace('{n}', String(value.length)) : s.doneBtn}
      </button>
    </dialog>
  );
}

/** The helpers field: a summary button that opens the dialog. `people` already leaves out the responsible person. */
export function HelpersField({
  people,
  value,
  onChange,
  disabled,
}: {
  people: readonly CompanyMember[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field">
      <span className="field-label">{s.helpers}</span>
      <button type="button" className="btn soft" disabled={disabled} onClick={() => setOpen(true)}>
        <Users size={16} aria-hidden />
        {value.length > 0 ? s.peopleSelected.replace('{n}', String(value.length)) : s.assignTitle}
      </button>
      {open ? (
        <HelpersDialog
          people={people}
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
