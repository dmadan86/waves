import { describe, expect, it } from 'vitest';
import {
  BUILTIN_COMPANY_TAGS,
  COMPANY_TAG_KEY_RE,
  INDUSTRY_PACKS,
  companyTagLabel,
  emptyMirror,
  materialiseGroup,
  type QueuedMutation,
  mergeCompanyTags,
  packTags,
  slugifyTagKey,
  rankTags,
  companyEntryFromRow,
  companyStatement,
  companySummary,
  evaluateCompanyPolicies,
  formatCompanyStatement,
} from '../src';

it('makes stable ASCII keys, including non-Latin labels', () => {
  expect(slugifyTagKey(' Cement bags! ')).toBe('cement-bags');
  expect(slugifyTagKey('Café')).toBe('cafe');
  for (const label of ['सीमेंट', 'சிமெண்ட்', 'اسمنت', '', 'x'.repeat(100)]) {
    expect(slugifyTagKey(label)).toMatch(COMPANY_TAG_KEY_RE);
    expect(slugifyTagKey(label)).toBe(slugifyTagKey(label));
  }
});
it('keeps hidden historical labels and merges only used builtins without mutation', () => {
  const tags = [{ key: 'cement', label: 'Cement bags', hidden: true }];
  expect(companyTagLabel('cement', tags)).toBe('Cement bags');
  expect(companyTagLabel('fuel', tags, () => 'Fuel translated')).toBe('Fuel translated');
  expect(companyTagLabel('cement-bags', [])).toBe('Cement bags');
  expect(mergeCompanyTags(tags, ['fuel', 'fuel', 'not-builtin'])).toEqual([
    ...tags,
    { key: 'fuel', label: 'Fuel' },
  ]);
  expect(tags).toHaveLength(1);
  expect(BUILTIN_COMPANY_TAGS).toHaveLength(6);
});
it('packs contain unique valid keys, report enum units and seed stars', () => {
  const units = new Set([
    'bag',
    'load',
    'trip',
    'tonne',
    'kg',
    'litre',
    'cft',
    'sqft',
    'nos',
    'km',
    'day',
    'hour',
    'month',
    'set',
    'box',
    'cylinder',
    'tanker',
    'acre',
    'quintal',
  ]);
  for (const industry of ['construction', 'transport', 'field_sales', 'common'] as const) {
    const tags = packTags(industry);
    expect(new Set(tags.map((t) => t.key)).size).toBe(tags.length);
    expect(tags.some((t) => t.starred)).toBe(true);
    for (const tag of tags) {
      expect(tag.key).toMatch(COMPANY_TAG_KEY_RE);
      if (tag.unit) expect(units.has(tag.unit)).toBe(true);
    }
  }
  expect(INDUSTRY_PACKS.construction.find((t) => t.key === 'cement')?.unit).toBe('bag');
});
describe('rankTags', () => {
  const now = Date.UTC(2026, 10, 1);
  const day = 86400000;
  it('counts the inclusive window, ignores future/invalid dates and breaks ties by latest', () => {
    const keys = Object.freeze(['a', 'b', 'c', 'd']);
    const uses = Object.freeze([
      { key: 'a', at: now - day },
      { key: 'a', at: now - 90 * day },
      { key: 'b', at: now },
      { key: 'b', at: now - day },
      { key: 'c', at: now + 1 },
      { key: 'c', at: 'invalid' },
      { key: 'd', at: now - 91 * day },
    ]);
    expect(rankTags({ keys, uses, now, starred: ['c'] })).toEqual(['b', 'a', 'c', 'd']);
    expect(keys).toEqual(['a', 'b', 'c', 'd']);
  });
  it('uses stars in supplied order then original order with no history', () => {
    expect(
      rankTags({ keys: ['a', 'b', 'c', 'd'], uses: [], now: new Date(now), starred: ['c', 'b'] }),
    ).toEqual(['c', 'b', 'a', 'd']);
  });
});
it('custom and prototype-shaped keys total in statements, summaries and policies', () => {
  const entry = companyEntryFromRow({
    id: 'e',
    group_id: 'g',
    member_id: 'm',
    entry_kind: 'expense',
    category: 'cement-bags',
    amount: '120',
    currency: 'INR',
    occurred_on: '2026-11-01',
    status: 'approved',
  });
  const range = { from: '2026-11-01', to: '2026-11-30' };
  const statement = companyStatement([entry], { ...range, memberId: 'm' });
  expect(statement.totals.byCategory['cement-bags']).toBe(120n);
  expect(companySummary([entry], range).totals.byCategory['cement-bags']).toBe(120n);
  expect(
    companyStatement([{ ...entry, category: 'constructor' }], { ...range, memberId: 'm' }).totals
      .byCategory['constructor'],
  ).toBe(120n);
  expect(
    formatCompanyStatement(statement, {
      company: 'Firm',
      employee: 'Ravi',
      money: String,
      tags: [{ key: 'cement-bags', label: 'Cement sacks' }],
    }),
  ).toContain('Cement sacks');
  expect(
    evaluateCompanyPolicies(
      entry,
      [],
      {
        version: 1,
        rules: [
          {
            id: 'c',
            type: 'period_limit',
            target: 'cement-bags',
            period: 'month',
            limitMinor: '100',
            effect: 'block',
          },
        ],
      },
      { hasReceipt: false },
    ),
  ).toMatchObject([{ code: 'PERIOD_LIMIT', target: 'cement-bags' }]);
});

it('replays queued tags into the groups mirror without mutating payloads', () => {
  const queue = [
    {
      seq: 1,
      kind: 'group.create',
      groupId: 'g',
      clientCreatedAt: '2026-11-01',
      payload: { type: 'company' },
    },
    { seq: 2, kind: 'company_tag.add', groupId: 'g', payload: { key: 'cement', label: 'Cement' } },
    { seq: 3, kind: 'company_tag.add', groupId: 'g', payload: { key: 'cement2', label: 'cEmEnT' } },
  ] as unknown as QueuedMutation[];
  const state = emptyMirror();
  expect(materialiseGroup(state, queue, 'g')?.company_tags).toEqual([
    { key: 'cement', label: 'Cement' },
  ]);
  const tags = [{ key: 'cement', label: 'Sacks', hidden: true }];
  const set = {
    seq: 4,
    kind: 'company_tags.set',
    groupId: 'g',
    payload: { tags, industry: 'construction' },
  } as unknown as QueuedMutation;
  expect(materialiseGroup(state, [...queue, set], 'g')).toMatchObject({
    company_tags: tags,
    company_industry: 'construction',
  });
  expect(tags).toEqual([{ key: 'cement', label: 'Sacks', hidden: true }]);
});
