import { describe, expect, it } from 'vitest';

import {
  archiveSuggestion,
  homeGroupRows,
  splitFamily,
  viewerLeft,
  type SectionEntry,
} from '../src/lib/groupSections';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-28T00:00:00Z');
const e = (id: string, over: Partial<SectionEntry> = {}): SectionEntry => ({
  id,
  label: id,
  balance: 0n,
  needsAction: false,
  lastActive: 0,
  type: 'trip',
  ledger_mode: null,
  ...over,
});

describe('splitFamily', () => {
  it('pins couple, home and pooled groups, newest activity first in each part', () => {
    const { family, groups } = splitFamily([
      e('trip-old', { lastActive: 1 }),
      e('couple', { type: 'couple', lastActive: 5 }),
      e('trip-new', { lastActive: 9 }),
      e('pool', { type: 'other', ledger_mode: 'pool', lastActive: 8 }),
      e('flat', { type: 'home', lastActive: 2 }),
    ]);
    expect(family.map((x) => x.id)).toEqual(['pool', 'couple', 'flat']);
    expect(groups.map((x) => x.id)).toEqual(['trip-new', 'trip-old']);
  });
  it('has no family part when there is no family space', () => {
    expect(splitFamily([e('a')]).family).toEqual([]);
  });
  it('searches both parts by name', () => {
    const r = splitFamily([e('Goa trip'), e('Our home', { type: 'couple' })], 'goa');
    expect(r.family).toEqual([]);
    expect(r.groups.map((x) => x.id)).toEqual(['Goa trip']);
  });
});

describe('former couple', () => {
  it('is not pinned as Family once the viewer has left', () => {
    const { family, groups } = splitFamily([e('c', { type: 'couple', former: true })]);
    expect(family).toEqual([]);
    expect(groups.map((x) => x.id)).toEqual(['c']);
  });
  it('is detected from the viewer own left_at only', () => {
    const m = [
      { profile_id: 'me', left_at: '2026-11-01T00:00:00Z' },
      { profile_id: 'p', left_at: null },
    ];
    expect(viewerLeft(m, 'me')).toBe(true);
    expect(viewerLeft(m, 'p')).toBe(false);
    expect(viewerLeft(m, null)).toBe(false);
  });
});

describe('homeGroupRows', () => {
  const fam = (n: number) => Array.from({ length: n }, (_, i) => e(`f${i}`));
  const grp = (n: number) => Array.from({ length: n }, (_, i) => e(`g${i}`));
  it('always shows every family space, then fills to the limit', () => {
    const r = homeGroupRows(fam(1), grp(9));
    expect(r.family).toHaveLength(1);
    expect(r.groups).toHaveLength(4);
  });
  it('keeps at least three groups even with many family spaces', () => {
    const r = homeGroupRows(fam(4), grp(9));
    expect(r.family).toHaveLength(4);
    expect(r.groups).toHaveLength(3);
  });
  it('shows five groups when there is no family', () => {
    expect(homeGroupRows([], grp(9)).groups).toHaveLength(5);
  });
});

describe('archiveSuggestion', () => {
  const quiet = { lastActive: NOW - 61 * DAY };
  it('offers a settled group quiet for 60 days', () => {
    expect(archiveSuggestion([e('goa', quiet)], NOW, new Set())?.id).toBe('goa');
  });
  it('waits until 60 days have passed', () => {
    expect(archiveSuggestion([e('a', { lastActive: NOW - 59 * DAY })], NOW, new Set())).toBeNull();
  });
  it('never offers family, unsettled or pending groups', () => {
    expect(archiveSuggestion([e('c', { ...quiet, type: 'couple' })], NOW, new Set())).toBeNull();
    expect(archiveSuggestion([e('b', { ...quiet, balance: 5n })], NOW, new Set())).toBeNull();
    expect(archiveSuggestion([e('p', { ...quiet, needsAction: true })], NOW, new Set())).toBeNull();
  });
  it('never offers a former (read-only) space', () => {
    expect(archiveSuggestion([e('x', { ...quiet, former: true })], NOW, new Set())).toBeNull();
  });
  it('does not ask again once kept', () => {
    expect(archiveSuggestion([e('goa', quiet)], NOW, new Set(['goa']))).toBeNull();
  });
});
