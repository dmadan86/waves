'use client';

/** Leave balances of one person, one block per leave type: days left, share of the year taken, Earned / Taken / Requested. */
import { calendarStrings as s } from '@/lib/company/calendarStrings';
import { daysText, useLeaveBalances } from '@/lib/company/leave';

export function LeaveBalanceCard({
  groupId,
  memberId,
}: {
  groupId: string;
  memberId: string | null;
}) {
  const rows = useLeaveBalances(groupId, memberId);
  if (rows.length === 0) return null;
  return (
    <section className="panel" aria-label={s.leaveBalances}>
      <h2>{s.leaveBalances}</h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
        {rows.map(({ type, balance, requested }) => {
          const earned = balance.carriedIn + balance.accrued;
          const taken = Math.min(balance.used, earned);
          const pct = earned > 0 ? Math.round((taken / earned) * 100) : balance.used > 0 ? 100 : 0;
          const color = balance.balance < 0 ? 'var(--w-negative)' : 'var(--w-brand)';
          return (
            <li key={type.id} className="bar-row">
              <span className="bar-head">
                <b className="bar-label">{type.name}</b>
                <span className="bar-value" style={{ color, fontSize: 18 }}>
                  {s.leaveDaysAvailable.replace('{n}', daysText(balance.balance))}
                </span>
              </span>
              <span className="bar-track" aria-hidden="true">
                <span
                  className="bar-fill"
                  style={{ width: `${Math.min(100, pct)}%`, background: color }}
                />
              </span>
              <span className="faint">
                {[
                  `${s.leaveEarned} ${daysText(earned)}`,
                  `${s.leaveTaken} ${daysText(balance.used)}`,
                  requested > 0 ? `${s.leaveRequested} ${daysText(requested)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
