import { describe, expect, it } from 'vitest';

import { eventDetailFacts } from '../src/lib/eventDetailFacts';

const subEvents = [{ id: 'venue', emoji: '📍' }];
const now = new Date('2026-10-05T12:00:00Z');

describe('eventDetailFacts', () => {
  it('shows nothing for a plain expense', () => {
    const facts = eventDetailFacts({ version: {}, subEvents, timeZone: 'Asia/Kolkata', now });
    expect(facts.subEvent).toBeNull();
    expect(facts.isDeposit).toBe(false);
    expect(facts.balanceDueMinor).toBeNull();
    expect(facts.overdue).toBe(false);
  });

  it('carries the sub-event with its emoji, and keeps an unknown id', () => {
    const known = eventDetailFacts({
      version: { sub_event_id: 'venue' },
      subEvents,
      timeZone: 'UTC',
      now,
    });
    expect(known.subEvent).toEqual({ id: 'venue', emoji: '📍' });
    const unknown = eventDetailFacts({
      version: { sub_event_id: 'gone' },
      subEvents,
      timeZone: 'UTC',
      now,
    });
    expect(unknown.subEvent).toEqual({ id: 'gone', emoji: '' });
  });

  it('reads the deposit balance and flags overdue only once the day has passed', () => {
    const base = { is_deposit: true, balance_due_minor: '300000' };
    const upcoming = eventDetailFacts({
      version: { ...base, balance_due_date: '2026-10-09' },
      subEvents,
      timeZone: 'Asia/Kolkata',
      now,
    });
    expect(upcoming.balanceDueMinor).toBe(300000n);
    expect(upcoming.overdue).toBe(false);
    const today = eventDetailFacts({
      version: { ...base, balance_due_date: '2026-10-05' },
      subEvents,
      timeZone: 'Asia/Kolkata',
      now,
    });
    expect(today.overdue).toBe(false);
    const late = eventDetailFacts({
      version: { ...base, balance_due_date: '2026-10-04' },
      subEvents,
      timeZone: 'Asia/Kolkata',
      now,
    });
    expect(late.overdue).toBe(true);
  });

  it('ignores balance fields when it is not a deposit, and a zero balance', () => {
    const notDeposit = eventDetailFacts({
      version: { is_deposit: false, balance_due_minor: '500', balance_due_date: '2020-01-01' },
      subEvents,
      timeZone: 'UTC',
      now,
    });
    expect(notDeposit.balanceDueMinor).toBeNull();
    expect(notDeposit.overdue).toBe(false);
    const zero = eventDetailFacts({
      version: { is_deposit: true, balance_due_minor: '0' },
      subEvents,
      timeZone: 'UTC',
      now,
    });
    expect(zero.isDeposit).toBe(true);
    expect(zero.balanceDueMinor).toBeNull();
  });
});
