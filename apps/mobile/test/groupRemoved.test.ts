import { describe, expect, it, vi } from 'vitest';

import { announceGroupsRemoved, insideRemovedGroup, onGroupsRemoved } from '@/lib/groupRemoved';

describe('groupRemoved', () => {
  const gone = [{ id: 'g1', name: 'Goa' }];
  it('tells listeners, and only when something was removed', () => {
    const seen = vi.fn();
    const off = onGroupsRemoved(seen);
    announceGroupsRemoved([]);
    announceGroupsRemoved(gone);
    off();
    announceGroupsRemoved(gone);
    expect(seen).toHaveBeenCalledTimes(1);
  });
  it('knows when the open screen belongs to a removed group', () => {
    expect(insideRemovedGroup('/group/g1', gone)).toBe(true);
    expect(insideRemovedGroup('/group/g1/expense/e1', gone)).toBe(true);
    expect(insideRemovedGroup('/group/g2', gone)).toBe(false);
    expect(insideRemovedGroup('/', gone)).toBe(false);
  });
});
