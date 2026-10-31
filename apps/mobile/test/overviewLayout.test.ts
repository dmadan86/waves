import { describe, expect, it } from 'vitest';

import {
  defaultLayout,
  hideCard,
  moveCard,
  resolveLayout,
  showCard,
  withOrder,
} from '../src/lib/overviewLayout';

describe('overview layout', () => {
  it('defaults per role, locked card first', () => {
    expect(defaultLayout('owner').order[0]).toBe('attendance');
    expect(defaultLayout('manager').order).toContain('budget');
    expect(defaultLayout('owner').order).not.toContain('budget');
  });

  it('resolves garbage to the default', () => {
    expect(resolveLayout('owner', null)).toEqual(defaultLayout('owner'));
    expect(resolveLayout('owner', 'x')).toEqual(defaultLayout('owner'));
    expect(resolveLayout('owner', { order: 5, hidden: {} })).toEqual(defaultLayout('owner'));
  });

  it('drops unknown, repeated and other-role ids; locked card goes first', () => {
    const l = resolveLayout('owner', {
      order: ['activity', 'nope', 'money', 'activity', 'budget', 'attendance'],
      hidden: ['upcoming', 'money'],
    });
    expect(l.order[0]).toBe('attendance');
    expect(l.order.filter((c) => c === 'activity')).toHaveLength(1);
    expect(l.hidden).toEqual(['upcoming']);
    expect([...l.order, ...l.hidden].sort()).toEqual([...defaultLayout('owner').order].sort());
  });

  it('puts a card added in a later version after its default predecessor', () => {
    const l = resolveLayout('owner', { order: ['attendance', 'money', 'upcoming', 'activity'] });
    expect(l.order).toEqual(['attendance', 'money', 'attention', 'upcoming', 'activity']);
  });

  it('moves, hides and shows, never touching the locked card', () => {
    const d = defaultLayout('owner');
    expect(moveCard('owner', d, 'money', -1)).toBe(d);
    expect(moveCard('owner', d, 'attendance', 1)).toBe(d);
    expect(moveCard('owner', d, 'activity', 1)).toBe(d);
    expect(moveCard('owner', d, 'money', 1).order.slice(1, 3)).toEqual(['attention', 'money']);
    expect(hideCard('owner', d, 'attendance')).toBe(d);
    const h = hideCard('owner', d, 'money');
    expect(h.order).not.toContain('money');
    expect(showCard(h, 'money').order.at(-1)).toBe('money');
    expect(withOrder('owner', d, ['activity', 'money']).order).toEqual([
      'attendance',
      'activity',
      'money',
    ]);
  });
});
