'use client';

import type { CalendarItem } from '@/lib/company/calendarItems';
import { calendarStrings as s } from '@/lib/company/calendarStrings';
import { todayIso } from '@/lib/company/view';

const DOT: Record<CalendarItem['kind'], string> = {
  leave: '#d97706',
  money: '#16a34a',
  work: '#2563eb',
  birthday: '#dc2626',
};

export function CompanyCalendarGrid({
  year,
  month,
  items,
  selectedDay,
  onSelect,
  onMonthChange,
}: {
  year: number;
  month: number;
  items: readonly CalendarItem[];
  selectedDay: string | null;
  onSelect: (day: string) => void;
  onMonthChange: (year: number, month: number) => void;
}) {
  const today = todayIso();
  const first = new Date(Date.UTC(year, month - 1, 1));
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const move = (by: number) => {
    const next = new Date(Date.UTC(year, month - 1 + by, 1));
    onMonthChange(next.getUTCFullYear(), next.getUTCMonth() + 1);
  };
  const cells = Array.from({ length: first.getUTCDay() + count }, (_, i) => i - first.getUTCDay() + 1);
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button type="button" className="btn soft" aria-label={s.prevMonth} onClick={() => move(-1)}>
          ‹
        </button>
        <strong>
          {first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}
        </strong>
        <button type="button" className="btn soft" aria-label={s.nextMonth} onClick={() => move(1)}>
          ›
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center' }}>
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="faint">
            {new Date(Date.UTC(2026, 0, 4 + i)).toLocaleDateString(undefined, {
              weekday: 'narrow',
              timeZone: 'UTC',
            })}
          </span>
        ))}
        {cells.map((n, i) => {
          if (n < 1) return <span key={i} />;
          const day = `${year}-${String(month).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
          const kinds = [...new Set(items.filter((it) => it.day === day).map((it) => it.kind))];
          return (
            <button
              key={i}
              type="button"
              className={day === selectedDay ? 'btn brand' : 'btn soft'}
              aria-pressed={day === selectedDay}
              aria-current={day === today ? 'date' : undefined}
              style={{ margin: 1, minHeight: 44, flexDirection: 'column' }}
              onClick={() => onSelect(day)}
            >
              {n}
              <span style={{ display: 'flex', gap: 2, height: 6 }}>
                {kinds.map((k) => (
                  <span
                    key={k}
                    style={{ width: 5, height: 5, borderRadius: 3, background: DOT[k] }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {(['leave', 'money', 'work', 'birthday'] as const).map((k) => (
          <span key={k} className="faint">
            <span style={{ color: DOT[k] }}>●</span>{' '}
            {{ leave: s.filterLeave, money: s.filterMoney, work: s.filterWork, birthday: s.filterBirthdays }[k]}
          </span>
        ))}
      </div>
    </div>
  );
}
