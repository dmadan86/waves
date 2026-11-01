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
    expect(defaultLayout('owner').order[0]).toBe('glance');
    expect(defaultLayout('owner').hidden).toContain('attendance');
    expect(defaultLayout('manager').order[0]).toBe('attendance');
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
      order: ['activity', 'nope', 'needs', 'activity', 'budget', 'glance'],
      hidden: ['upcoming', 'needs'],
    });
    expect(l.order[0]).toBe('glance');
    expect(l.order.filter((c) => c === 'activity')).toHaveLength(1);
    expect(l.hidden).toEqual(expect.arrayContaining(['upcoming', 'attendance']));
    const d = defaultLayout('owner');
    expect([...l.order, ...l.hidden].sort()).toEqual([...d.order, ...d.hidden].sort());
  });

  it('puts a card added in a later version after its default predecessor', () => {
    const l = resolveLayout('owner', { order: ['glance', 'needs', 'comingUp', 'activity'] });
    expect(l.order).toEqual(['glance', 'needs', 'moneyActions', 'comingUp', 'activity']);
    expect(l.hidden).toEqual(['attendance', 'money', 'attention', 'upcoming']);
  });

  it('gives an owner layout saved before the redesign the new default', () => {
    expect(
      resolveLayout('owner', { order: ['attendance', 'money', 'attention'], hidden: ['activity'] }),
    ).toEqual(defaultLayout('owner'));
  });

  it('moves, hides and shows, never touching the locked card', () => {
    const d = defaultLayout('owner');
    expect(moveCard('owner', d, 'needs', -1)).toBe(d);
    expect(moveCard('owner', d, 'glance', 1)).toBe(d);
    expect(moveCard('owner', d, 'activity', 1)).toBe(d);
    expect(moveCard('owner', d, 'needs', 1).order.slice(1, 3)).toEqual(['moneyActions', 'needs']);
    expect(hideCard('owner', d, 'glance')).toBe(d);
    const h = hideCard('owner', d, 'needs');
    expect(h.order).not.toContain('needs');
    expect(showCard(h, 'needs').order.at(-1)).toBe('needs');
    expect(withOrder('owner', d, ['activity', 'needs']).order).toEqual([
      'glance',
      'activity',
      'needs',
    ]);
  });
});
