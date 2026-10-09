import { describe, expect, it } from 'vitest';
import { GroupType } from '../src/data/types';
import {
  showsDepositRow,
  showsSubEventRow,
  showsUpcomingPayments,
  showsVendorTools,
} from '../src/lib/eventOrganizer';

describe('showsVendorTools', () => {
  it.each(Object.values(GroupType))('%s group', (type) => {
    expect(showsVendorTools(type)).toBe(type === GroupType.Event);
  });

  it('is false while the group is loading or the type is unknown', () => {
    expect(showsVendorTools(undefined)).toBe(false);
    expect(showsVendorTools(null)).toBe(false);
    expect(showsVendorTools('')).toBe(false);
    expect(showsVendorTools('wedding')).toBe(false);
  });
});

describe('showsDepositRow', () => {
  it.each(Object.values(GroupType))('%s group, not a deposit', (type) => {
    expect(showsDepositRow(type, false)).toBe(type === GroupType.Event);
  });

  it.each(Object.values(GroupType))('%s group, already a deposit keeps the row', (type) => {
    expect(showsDepositRow(type, true)).toBe(true);
  });

  it('hides the row while the group loads unless it is already a deposit', () => {
    expect(showsDepositRow(undefined, false)).toBe(false);
    expect(showsDepositRow(null, true)).toBe(true);
  });
});

describe('showsSubEventRow', () => {
  it.each(Object.values(GroupType))('%s group', (type) => {
    expect(showsSubEventRow(type, null)).toBe(type === GroupType.Event);
    expect(showsSubEventRow(type, 'venue')).toBe(true);
  });

  it('hides the row while loading unless already tagged', () => {
    expect(showsSubEventRow(undefined, undefined)).toBe(false);
    expect(showsSubEventRow(null, 'venue')).toBe(true);
  });
});

describe('showsUpcomingPayments', () => {
  it.each(Object.values(GroupType))('%s group with no open deposit', (type) => {
    expect(showsUpcomingPayments(type, 0)).toBe(type === GroupType.Event);
  });

  it.each(Object.values(GroupType))('%s group with an open deposit', (type) => {
    expect(showsUpcomingPayments(type, 1)).toBe(true);
  });

  it('hides while loading with no open deposit', () => {
    expect(showsUpcomingPayments(undefined, 0)).toBe(false);
  });
});
