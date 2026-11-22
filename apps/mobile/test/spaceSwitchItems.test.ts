import { describe, expect, it, vi } from 'vitest';

import { buildSpaceSwitchItems } from '@/lib/spaceSwitchItems';

const groups = [
  { id: 'c', type: 'couple' },
  { id: 't', type: 'trip' },
  { id: 'h', type: 'home' },
  { id: 'o', type: 'other' },
];
const make = (shared: boolean, over: Partial<Parameters<typeof buildSpaceSwitchItems>[0]> = {}) => {
  const fns = { goPersonal: vi.fn(), goShared: vi.fn(), openGroup: vi.fn() };
  const items = buildSpaceSwitchItems({
    shared,
    labels: { shared: 'Shared', personal: 'Personal' },
    groups,
    groupLabel: (g) => `label-${g.id}`,
    ...fns,
    ...over,
  });
  return { items, ...fns };
};

describe('buildSpaceSwitchItems', () => {
  it('Shared side: Shared (ticked), Personal, then the couple and home groups in arrival order', () => {
    const { items } = make(true);
    expect(items.map((i) => i.label)).toEqual(['Shared', 'Personal', 'label-c', 'label-h']);
    expect(items[0]?.icon).toBe('checkmark');
    expect(items[1]?.icon).toBe('people-outline');
  });

  it('Personal side: Personal (ticked), the groups, then Shared last', () => {
    const { items } = make(false);
    expect(items.map((i) => i.label)).toEqual(['Personal', 'label-c', 'label-h', 'Shared']);
    expect(items[0]?.icon).toBe('checkmark');
    expect(items[3]?.icon).toBe('people-outline');
  });

  it('lists only couple and home groups, with heart and home icons', () => {
    const { items } = make(true);
    const g = items.slice(2);
    expect(g.map((i) => i.icon)).toEqual(['heart-outline', 'home-outline']);
  });

  it('uses the supplied display name for each group (demo or named)', () => {
    const { items } = make(true, { groupLabel: (g) => (g.id === 'c' ? 'You and Asha' : 'Demo group') });
    expect(items.slice(2).map((i) => i.label)).toEqual(['You and Asha', 'Demo group']);
  });

  it('the current space does nothing when tapped; the other navigates; groups open', () => {
    const shared = make(true);
    shared.items[0]?.onPress();
    expect(shared.goPersonal).not.toHaveBeenCalled();
    expect(shared.goShared).not.toHaveBeenCalled();
    shared.items[1]?.onPress();
    expect(shared.goPersonal).toHaveBeenCalledOnce();
    shared.items[2]?.onPress();
    expect(shared.openGroup).toHaveBeenCalledWith('c');

    const personal = make(false);
    personal.items[0]?.onPress();
    expect(personal.goPersonal).not.toHaveBeenCalled();
    personal.items[3]?.onPress();
    expect(personal.goShared).toHaveBeenCalledOnce();
  });

  it('no groups gives just the two spaces, in side order', () => {
    expect(make(true, { groups: [] }).items.map((i) => i.label)).toEqual(['Shared', 'Personal']);
    expect(make(false, { groups: [] }).items.map((i) => i.label)).toEqual(['Personal', 'Shared']);
  });
});
