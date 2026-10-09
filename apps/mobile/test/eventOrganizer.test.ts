import { describe, expect, it } from 'vitest';
import { GroupType } from '../src/data/types';
import { showsDepositRow, showsVendorTools } from '../src/lib/eventOrganizer';

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
