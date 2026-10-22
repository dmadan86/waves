import { describe, expect, it } from 'vitest';

import {
  EMPTY_HISTORY,
  NEW_SESSION,
  DEFAULT_PREFS,
  addDaysIso,
  nextMonthlyDate,
  advanceSession,
  buildHistoryStats,
  detectLendTarget,
  detectOtherPayer,
  findDuplicate,
  findRecurring,
  isMuted,
  learningFor,
  markWrapUpShown,
  medianOf,
  nextFollowUp,
  parsePrefs,
  recordAnswer,
  recordSkip,
  resetMuted,
  suggestCategories,
  type FollowUpEnvironment,
  type FollowUpKind,
  type FollowUpPrefs,
  type FollowUpSession,
  type HistoryRecord,
  type HistoryStats,
  type SavedExpenseFacts,
} from '../src/voice/followUps';

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const env = (over: Partial<FollowUpEnvironment> = {}): FollowUpEnvironment => ({
  currentPlace: null,
  deviceCurrency: null,
  hour: 15,
  nowMs: NOW,
  today: '2026-10-19',
  ...over,
});

const personal = (over: Partial<SavedExpenseFacts> = {}): SavedExpenseFacts => ({
  scope: 'personal',
  expenseId: 'e1',
  amountMinor: 800000n,
  currency: 'INR',
  category: 'shopping',
  categoryStated: true,
  description: 'shoes',
  date: '2026-10-19',
  hasPlace: false,
  hasReceipt: false,
  hasNotes: false,
  hasPaymentMethod: true,
  canAttachReceipt: false,
  canSetPayment: true,
  groupId: null,
  groupName: null,
  members: [],
  splitParticipantCount: 1,
  payerIsMe: true,
  ...over,
});

const members = [
  { id: 'm1', name: 'Me', isMe: true },
  { id: 'm2', name: 'Ravi Kumar', isMe: false },
  { id: 'm3', name: 'Priya', isMe: false },
];
const group = (over: Partial<SavedExpenseFacts> = {}): SavedExpenseFacts =>
  personal({
    scope: 'group',
    groupId: 'g1',
    groupName: 'Goa trip',
    members,
    splitParticipantCount: 3,
    category: 'food',
    description: 'dinner',
    canAttachReceipt: false,
    hasPaymentMethod: true,
    ...over,
  });

const history = (over: Partial<HistoryStats> = {}): HistoryStats => ({ ...EMPTY_HISTORY, ...over });
const withPlaces = history({ recentPlaces: ['Cafe Mocha'] });

const ask = (
  expense: SavedExpenseFacts,
  h: HistoryStats,
  extra: {
    prefs?: FollowUpPrefs;
    session?: FollowUpSession;
    env?: FollowUpEnvironment;
  } = {},
) =>
  nextFollowUp({
    expense,
    history: h,
    prefs: extra.prefs ?? DEFAULT_PREFS,
    session: extra.session ?? NEW_SESSION,
    env: extra.env ?? env(),
  });

describe('the hard rules', () => {
  it('asks nothing when the master switch is off', () => {
    const off = { ...DEFAULT_PREFS, enabled: false };
    expect(
      ask(personal(), withPlaces, { prefs: off, env: env({ currentPlace: 'Phoenix Mall' }) }),
    ).toBeNull();
  });

  it('asks nothing for a small spend: below the median when there is history', () => {
    const records: HistoryRecord[] = Array.from({ length: 6 }, (_, i) => ({
      scope: 'personal',
      amountMinor: BigInt((i + 1) * 100000),
      currency: 'INR',
      category: 'food',
      description: `x${i}`,
      date: '2026-09-01',
      partners: [],
      place: 'Cafe Mocha',
      at: '2026-09-01',
    }));
    const h = buildHistoryStats(records); // median 350000
    expect(
      ask(personal({ amountMinor: 200000n }), h, { env: env({ currentPlace: 'Mall' }) }),
    ).toBeNull();
    expect(
      ask(personal({ amountMinor: 400000n }), h, { env: env({ currentPlace: 'Mall' }) })?.kind,
    ).toBe('place');
  });

  it('asks nothing below the floor when there is no history', () => {
    expect(
      ask(personal({ amountMinor: 15000n }), withPlaces, { env: env({ currentPlace: 'Mall' }) }),
    ).toBeNull();
    expect(
      ask(personal({ amountMinor: 25000n }), withPlaces, { env: env({ currentPlace: 'Mall' }) })
        ?.kind,
    ).toBe('place');
  });

  it('never asks about what is already filled', () => {
    const e = env({ currentPlace: 'Mall' });
    expect(ask(personal({ hasPlace: true }), withPlaces, { env: e })).toBeNull();
    const big = group({
      amountMinor: 90000000n,
      hasReceipt: true,
      hasPlace: true,
      canAttachReceipt: true,
      category: 'travel',
      description: 'flight',
    });
    expect(ask(big, history(), { env: e })).toBeNull();
    expect(ask(personal({ hasPaymentMethod: true }), history())).toBeNull();
  });

  it('asks at most two per expense, never repeating a type', () => {
    const h = history({ recentPlaces: ['Cafe'] });
    const e = group({
      canAttachReceipt: true,
      hasPaymentMethod: false,
      canSetPayment: true,
      amountMinor: 900000n,
      category: 'travel',
      description: 'cab',
    });
    const first = ask(e, h)!;
    const s1 = advanceSession(NEW_SESSION, first.kind, 'answered');
    const second = ask(e, h, { session: s1 })!;
    expect(second.kind).not.toBe(first.kind);
    const s2 = advanceSession(s1, second.kind, 'answered');
    expect(ask(e, h, { session: s2 })).toBeNull();
  });

  it('stops after two skips or dismissals in a row, and on Done', () => {
    let s = advanceSession(NEW_SESSION, 'place', 'skipped');
    expect(s.stopped).toBe(false);
    s = advanceSession(s, 'receipt', 'dismissed');
    expect(s.stopped).toBe(true);
    expect(
      ask(personal(), withPlaces, { session: s, env: env({ currentPlace: 'Mall' }) }),
    ).toBeNull();
    expect(advanceSession(NEW_SESSION, 'place', 'done').stopped).toBe(true);
  });

  it('an answer resets the run of skips', () => {
    let s = advanceSession(NEW_SESSION, 'place', 'skipped');
    s = advanceSession(s, 'receipt', 'answered');
    expect(s.consecutiveSkips).toBe(0);
    expect(s.stopped).toBe(false);
  });
});

describe('muting', () => {
  it('three skips of one type mute it', () => {
    let p = DEFAULT_PREFS;
    p = recordSkip(p, 'place', 'food');
    p = recordSkip(p, 'place', 'food');
    expect(isMuted(p, 'place')).toBe(false);
    p = recordSkip(p, 'place', 'food');
    expect(isMuted(p, 'place')).toBe(true);
    expect(
      ask(personal(), withPlaces, { prefs: p, env: env({ currentPlace: 'Mall' }) }),
    ).toBeNull();
  });

  it('"Don\'t ask this again" is a mute, and reset brings it back', () => {
    const p: FollowUpPrefs = { ...DEFAULT_PREFS, muted: ['place'] };
    expect(
      ask(personal(), withPlaces, { prefs: p, env: env({ currentPlace: 'Mall' }) }),
    ).toBeNull();
    const reset = resetMuted({ ...recordSkip(p, 'place'), enabled: true });
    expect(isMuted(reset, 'place')).toBe(false);
    expect(reset.learned).toEqual({});
  });

  it('an answer clears the skip count', () => {
    const p = recordAnswer(recordSkip(DEFAULT_PREFS, 'place'), 'place');
    expect(p.skips.place).toBeUndefined();
  });

  it('survives storage: parse is total', () => {
    const p = recordSkip(recordSkip(DEFAULT_PREFS, 'split', 'groceries'), 'work');
    expect(parsePrefs(JSON.stringify(p))).toEqual(p);
    expect(parsePrefs('nonsense')).toEqual(DEFAULT_PREFS);
    expect(
      parsePrefs(JSON.stringify({ muted: ['bogus', 'place'], skips: { place: -2, split: 2 } }))
        .muted,
    ).toEqual(['place']);
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  });
});

describe('place', () => {
  it('offers where you are now first, then recent places', () => {
    const q = ask(personal(), history({ recentPlaces: ['Cafe', 'Gym', 'Mall'] }), {
      env: env({ currentPlace: 'Phoenix Mall' }),
    })!;
    expect(q.kind).toBe('place');
    expect(q.hereNow).toBe(true);
    expect(q.places[0]).toBe('Phoenix Mall');
  });
  it('falls back to recent places, and is skipped with neither', () => {
    expect(ask(personal(), history({ recentPlaces: ['Cafe'] }))?.places).toEqual(['Cafe']);
    expect(ask(personal(), history())).toBeNull();
  });
});

describe('receipt', () => {
  it('is weighted up for large amounts and business-like categories', () => {
    const h = history({ byCurrency: { INR: { median: 100000n, count: 10 } } });
    const small = ask(
      group({
        amountMinor: 100000n,
        category: 'groceries',
        description: 'veg',
        canAttachReceipt: true,
      }),
      h,
    )!;
    const large = ask(
      group({
        amountMinor: 600000n,
        category: 'travel',
        description: 'hotel',
        canAttachReceipt: true,
      }),
      h,
    )!;
    expect(small?.kind).not.toBe('receipt');
    expect(large.kind).toBe('receipt');
  });
  it('is not offered where a receipt cannot be kept (personal)', () => {
    expect(ask(personal({ amountMinor: 90000000n, hasPaymentMethod: true }), history())).toBeNull();
  });
});

describe('split (personal only)', () => {
  const partners = {
    food: [{ memberId: 'm2', groupId: 'g1', name: 'Ravi', count: 4 }],
  };
  it('suggests frequent partners for the category', () => {
    const q = ask(
      personal({ category: 'food', description: 'lunch' }),
      history({ partnersByCategory: partners }),
    )!;
    expect(q.kind).toBe('split');
    expect(q.partners[0]?.name).toBe('Ravi');
  });
  it('is never asked on a group expense', () => {
    expect(
      ask(
        group({ category: 'food', description: 'lunch', splitParticipantCount: 2 }),
        history({ partnersByCategory: partners }),
      ),
    ).toBeNull();
  });
  it('ignores one-off partners', () => {
    const once = { food: [{ memberId: 'm2', groupId: 'g1', name: 'Ravi', count: 1 }] };
    expect(ask(personal({ category: 'food' }), history({ partnersByCategory: once }))).toBeNull();
  });
});

describe('payment', () => {
  it('asks when missing and storable', () => {
    expect(ask(personal({ hasPaymentMethod: false }), history())?.kind).toBe('payment');
    expect(ask(personal({ hasPaymentMethod: false, canSetPayment: false }), history())).toBeNull();
  });
});

describe('1 wrong place: a trip is on', () => {
  const trips = [
    {
      groupId: 'g9',
      name: 'Goa trip',
      startDate: '2026-10-17',
      endDate: '2026-10-22',
      quietDays: 0,
    },
  ];
  it('asks about the trip for a personal cab', () => {
    const q = ask(
      personal({ description: 'cab to airport', category: 'travel' }),
      history({ trips }),
    )!;
    expect(q.kind).toBe('trip');
    expect(q.trip?.name).toBe('Goa trip');
  });
  it('not outside the trip dates, and not for a group expense', () => {
    expect(
      ask(personal({ date: '2026-11-02', description: 'cab' }), history({ trips })),
    ).toBeNull();
    expect(
      ask(group({ category: 'travel', description: 'cab' }), history({ trips }))?.kind,
    ).not.toBe('trip');
  });
});

describe('2 who was there', () => {
  it('asks for a group meal split among everyone, group > 2 only', () => {
    expect(ask(group(), history())?.kind).toBe('attendance');
    expect(
      ask(group({ members: members.slice(0, 2), splitParticipantCount: 2 }), history()),
    ).toBeNull();
  });
  it('not when only some share it, or for rent', () => {
    expect(ask(group({ splitParticipantCount: 2 }), history())).toBeNull();
    expect(ask(group({ category: 'home' }), history())).toBeNull();
  });
});

describe('3 who paid', () => {
  it('spots "Ravi paid" when you are down as payer', () => {
    expect(detectOtherPayer('dinner paid by Ravi', members)?.id).toBe('m2');
    expect(detectOtherPayer('Priya treated us', members)?.id).toBe('m3');
    expect(detectOtherPayer('paid Ravi back', members)).toBeNull();
    expect(detectOtherPayer('dinner', members)).toBeNull();
  });
  it('asks, and outranks the rest', () => {
    const q = ask(group({ description: 'Ravi paid for dinner' }), history())!;
    expect(q.kind).toBe('payer');
    expect(q.payer?.name).toBe('Ravi Kumar');
  });
  it('is silent when someone else is already the payer', () => {
    expect(
      ask(
        group({ description: 'Ravi paid', payerIsMe: false, splitParticipantCount: 2 }),
        history(),
      ),
    ).toBeNull();
  });
});

describe('4 recurring', () => {
  const past = (date: string, amountMinor = 150000n) => ({
    description: 'Netflix',
    amountMinor,
    currency: 'INR',
    date,
  });
  const e = personal({
    description: 'Netflix',
    amountMinor: 150000n,
    date: '2026-10-19',
    category: 'entertainment',
  });
  it('needs two earlier months, similar amount, similar day', () => {
    expect(findRecurring(e, [past('2026-09-18'), past('2026-08-20', 155000n)], [])).toEqual({
      dayOfMonth: 19,
    });
    expect(findRecurring(e, [past('2026-09-18')], [])).toBeNull();
    expect(findRecurring(e, [past('2026-09-18'), past('2026-09-19')], [])).toBeNull();
    expect(findRecurring(e, [past('2026-09-18'), past('2026-08-20', 250000n)], [])).toBeNull();
    expect(findRecurring(e, [past('2026-09-02'), past('2026-08-02')], [])).toBeNull();
  });
  it('is quiet when a rule already exists, and for groups', () => {
    expect(findRecurring(e, [past('2026-09-18'), past('2026-08-20')], ['netflix'])).toBeNull();
    expect(
      findRecurring(
        group({ description: 'Netflix' }),
        [past('2026-09-18'), past('2026-08-20')],
        [],
      ),
    ).toBeNull();
  });
  it('is asked through the scorer', () => {
    const h = history({ pastPersonal: [past('2026-09-18'), past('2026-08-20')] });
    expect(ask(e, h)?.kind).toBe('recurring');
  });
});

describe('5 duplicate guard', () => {
  const other = (over = {}) => ({
    groupId: 'g1',
    expenseId: 'x9',
    byOther: true,
    authorName: 'Priya',
    amountMinor: 120000n,
    currency: 'INR',
    description: 'Dinner',
    createdMs: NOW - 3600_000,
    ...over,
  });
  const mine = group({ amountMinor: 121000n });
  it('finds a similar amount by someone else within a day', () => {
    expect(findDuplicate(mine, [other()], NOW)?.authorName).toBe('Priya');
    expect(findDuplicate(mine, [other({ createdMs: NOW - 25 * 3600_000 })], NOW)).toBeNull();
    expect(findDuplicate(mine, [other({ amountMinor: 140000n })], NOW)).toBeNull();
    expect(findDuplicate(mine, [other({ byOther: false })], NOW)).toBeNull();
    expect(findDuplicate(mine, [other({ groupId: 'g2' })], NOW)).toBeNull();
    expect(findDuplicate(mine, [other({ expenseId: 'e1' })], NOW)).toBeNull();
  });
  it('has top priority and bypasses the small-spend rule', () => {
    const tiny = group({ amountMinor: 5000n });
    const h = history({
      recentGroupExpenses: [other({ amountMinor: 5000n })],
      recentPlaces: ['Cafe'],
    });
    expect(ask(tiny, h)?.kind).toBe('duplicate');
    // while another kind does not slip through the same door
    expect(ask(tiny, history({ recentPlaces: ['Cafe'] }))).toBeNull();
  });
  it('can still be muted or switched off', () => {
    const h = history({ recentGroupExpenses: [other()] });
    expect(ask(mine, h, { prefs: { ...DEFAULT_PREFS, muted: ['duplicate'] } })?.kind).not.toBe(
      'duplicate',
    );
    expect(ask(mine, h, { prefs: { ...DEFAULT_PREFS, enabled: false } })).toBeNull();
  });
});

describe('6 currency check', () => {
  it('asks when the phone is in another currency', () => {
    const q = ask(personal(), history(), { env: env({ deviceCurrency: 'AED' }) })!;
    expect(q.kind).toBe('currency');
    expect(q.currency).toBe('AED');
  });
  it('silent when it matches, unknown (no permission), or for groups', () => {
    expect(ask(personal(), history(), { env: env({ deviceCurrency: 'INR' }) })).toBeNull();
    expect(ask(personal(), history(), { env: env({ deviceCurrency: null }) })).toBeNull();
    expect(
      ask(group({ category: 'home' }), history(), { env: env({ deviceCurrency: 'AED' }) }),
    ).toBeNull();
  });
});

describe('7 category unsure', () => {
  it('offers three, the favourites first', () => {
    expect(suggestCategories(['groceries', 'other', 'food'], null)).toEqual([
      'groceries',
      'food',
      'shopping',
    ]);
    const q = ask(
      personal({ category: null, categoryStated: false, description: 'misc stuff' }),
      history({ topCategories: ['health'] }),
    )!;
    expect(q.kind).toBe('category');
    expect(q.categories).toHaveLength(3);
  });
  it('not when stated or when the words are clear', () => {
    expect(
      ask(personal({ category: 'other', categoryStated: true, description: 'zzz' }), history()),
    ).toBeNull();
    expect(
      ask(personal({ category: null, categoryStated: false, description: 'pizza' }), history()),
    ).toBeNull();
  });
});

describe('8 date', () => {
  it('between midnight and 4am asks about yesterday', () => {
    const q = ask(personal(), history(), { env: env({ hour: 1 }) })!;
    expect(q.kind).toBe('date');
    expect(q.suggestedDate).toBe('2026-10-18');
    expect(ask(personal(), history(), { env: env({ hour: 4 }) })).toBeNull();
  });
  it('asks when the words say yesterday but the date is today', () => {
    const q = ask(personal({ description: 'dinner last night' }), history())!;
    expect(q.kind).toBe('date');
    expect(
      ask(personal({ description: 'dinner yesterday', date: '2026-10-18' }), history()),
    ).toBeNull();
  });
  it('rolls month ends', () => {
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(nextMonthlyDate('2026-01-31')).toBe('2026-02-28');
    expect(nextMonthlyDate('2026-12-19')).toBe('2027-01-19');
  });
});

describe('9 money given to a person', () => {
  it('finds the person', () => {
    expect(detectLendTarget('gave 5000 to Ravi')).toBe('Ravi');
    expect(detectLendTarget('lent ravi')).toBe('Ravi');
    expect(detectLendTarget('8000 for Ravi')).toBe('Ravi');
    expect(detectLendTarget('lunch')).toBeNull();
    expect(detectLendTarget('gave to the maid'.replace('maid', 'office'))).toBeNull();
    expect(detectLendTarget('birthday gift for dinner')).toBeNull();
  });
  it('asks on a personal expense only', () => {
    expect(ask(personal({ description: 'gave 5000 to Ravi' }), history())?.person).toBe('Ravi');
    expect(
      ask(group({ description: 'gave to Ravi', splitParticipantCount: 2 }), history()),
    ).toBeNull();
  });
});

describe('11 trip wrap-up', () => {
  const trip = (over = {}) => ({
    groupId: 'g1',
    name: 'Goa trip',
    startDate: '2026-10-01',
    endDate: '2026-10-10',
    quietDays: 0,
    ...over,
  });
  const e = group({ category: 'home', description: 'taxi dues', amountMinor: 900000n });
  it('after the end date, or five quiet days', () => {
    expect(ask(e, history({ trips: [trip()] }))?.kind).toBe('wrapup');
    expect(ask(e, history({ trips: [trip({ endDate: null, quietDays: 5 })] }))?.kind).toBe(
      'wrapup',
    );
    expect(ask(e, history({ trips: [trip({ endDate: '2026-10-25', quietDays: 4 })] }))).toBeNull();
  });
  it('at most once per group', () => {
    const shown = markWrapUpShown(DEFAULT_PREFS, 'g1');
    expect(ask(e, history({ trips: [trip()] }), { prefs: shown })).toBeNull();
  });
});

describe('12 claim from work', () => {
  const h = history({ byCurrency: { INR: { median: 100000n, count: 10 } } });
  it('low weight; asked for travel above the median', () => {
    const q = ask(
      personal({
        category: 'travel',
        description: 'train',
        amountMinor: 250000n,
        hasPaymentMethod: true,
      }),
      h,
    )!;
    expect(q.kind).toBe('work');
    expect(ask(personal({ category: 'groceries', amountMinor: 250000n }), h)).toBeNull();
  });
  it('mutes after the first No', () => {
    const p = recordSkip(DEFAULT_PREFS, 'work', 'travel');
    expect(isMuted(p, 'work')).toBe(true);
    expect(
      ask(personal({ category: 'travel', description: 'train', amountMinor: 250000n }), h, {
        prefs: p,
      }),
    ).toBeNull();
  });
  it('anything else outranks it', () => {
    const q = ask(
      personal({ category: 'travel', description: 'cab', amountMinor: 250000n }),
      history({ ...h, recentPlaces: ['Cafe'] }),
    )!;
    expect(q.kind).toBe('place');
  });
});

describe('learning per category', () => {
  const partners = { groceries: [{ memberId: 'm2', groupId: 'g1', name: 'Ravi', count: 5 }] };
  const h = history({ partnersByCategory: partners });
  const e = personal({ category: 'groceries', description: 'veg', amountMinor: 300000n });

  it('stops asking split on groceries after repeated skips with no yes', () => {
    expect(ask(e, h)?.kind).toBe('split');
    let p = DEFAULT_PREFS;
    p = recordSkip(p, 'split', 'groceries');
    p = recordSkip(p, 'split', 'groceries');
    expect(learningFor(p, 'split', 'groceries').blocked).toBe(false);
    // The type itself is not muted yet (2 skips): the third lands the block.
    p = { ...p, skips: {} };
    p = recordSkip(p, 'split', 'groceries');
    expect(learningFor(p, 'split', 'groceries').blocked).toBe(true);
    expect(ask(e, h, { prefs: { ...p, skips: {}, muted: [] } })).toBeNull();
  });
  it('is per category: food is unaffected', () => {
    let p = DEFAULT_PREFS;
    for (let i = 0; i < 3; i++) p = recordSkip(p, 'split', 'groceries');
    expect(learningFor(p, 'split', 'food')).toEqual({ blocked: false, delta: 0 });
  });
  it('an answer earns score back and prevents the block', () => {
    let p = recordAnswer(DEFAULT_PREFS, 'split', 'groceries');
    for (let i = 0; i < 3; i++)
      p = { ...recordSkip(p, 'split', 'groceries'), skips: {}, muted: [] };
    expect(learningFor(p, 'split', 'groceries').blocked).toBe(false);
    expect(learningFor(p, 'split', 'groceries').delta).toBeLessThan(0);
  });
  it('lowers the score by what was skipped', () => {
    const marginal = history({
      partnersByCategory: {
        groceries: [{ memberId: 'm2', groupId: 'g1', name: 'Ravi', count: 2 }],
      },
    });
    expect(ask(e, marginal)?.score).toBe(41);
    const once = { ...recordSkip(DEFAULT_PREFS, 'split', 'groceries'), skips: {} };
    expect(ask(e, marginal, { prefs: once })?.score).toBe(33);
    const twice = { ...recordSkip(once, 'split', 'groceries'), skips: {} };
    expect(ask(e, marginal, { prefs: twice })).toBeNull();
  });
});

describe('history stats', () => {
  it('medians, partners, places', () => {
    expect(medianOf([3n, 1n, 2n])).toBe(2n);
    expect(medianOf([1n, 2n, 3n, 4n])).toBe(2n);
    const rec = (over: Partial<HistoryRecord>): HistoryRecord => ({
      scope: 'group',
      amountMinor: 100n,
      currency: 'inr',
      category: 'food',
      description: 'd',
      date: '2026-10-01',
      partners: [{ memberId: 'm2', groupId: 'g1', name: 'Ravi' }],
      place: null,
      at: '2026-10-01',
      ...over,
    });
    const s = buildHistoryStats([
      rec({}),
      rec({ place: 'A', at: '2026-10-02' }),
      rec({ place: 'B', at: '2026-10-03' }),
    ]);
    expect(s.byCurrency.INR).toEqual({ median: 100n, count: 3 });
    expect(s.partnersByCategory.food?.[0]?.count).toBe(3);
    expect(s.recentPlaces).toEqual(['B', 'A']);
    expect(s.topCategories).toEqual(['food']);
  });
});

export type _Unused = FollowUpKind;

describe('prefs keep what they do not understand', () => {
  it('unknown top-level keys survive parse, a skip, and a reset', () => {
    const raw = JSON.stringify({ enabled: false, muted: ['place'], futureThing: { a: 1 }, v: 2 });
    const parsed = parsePrefs(raw);
    const back = JSON.parse(JSON.stringify(recordSkip(parsed, 'split', 'food')));
    expect(back.futureThing).toEqual({ a: 1 });
    expect(back.v).toBe(2);
    expect(back.enabled).toBe(false);
    expect(JSON.parse(JSON.stringify(resetMuted(parsed))).futureThing).toEqual({ a: 1 });
  });
});
