import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_PREFS,
  EMPTY_HISTORY,
  NEW_SESSION,
  FOLLOW_UP_KINDS,
  MAX_QUESTIONS,
  MIN_SCORE,
  nextFollowUp,
  floorMinor,
  normaliseDescription,
  type SavedExpenseFacts,
  type HistoryStats,
  type FollowUpEnvironment,
  type FollowUpPrefs,
  type FollowUpSession,
  type RecentGroupExpense,
  type TripInfo,
} from '../src/voice/followUps';

const NOW = Date.UTC(2026, 9, 21, 12);
const members = [
  { id: 'm-me', name: 'Madan', isMe: true },
  { id: 'm-anu', name: 'Anu', isMe: false },
  { id: 'm-ravi', name: 'Ravi', isMe: false },
];
const facts = (over: Partial<SavedExpenseFacts> = {}): SavedExpenseFacts => ({
  scope: 'personal',
  expenseId: 'mine',
  amountMinor: 800000n,
  currency: 'INR',
  category: 'shopping',
  categoryStated: true,
  description: 'shoes',
  date: '2026-10-21',
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
const history = (over: Partial<HistoryStats> = {}): HistoryStats => ({ ...EMPTY_HISTORY, ...over });
const env = (over: Partial<FollowUpEnvironment> = {}): FollowUpEnvironment => ({
  hour: 15,
  currentPlace: null,
  deviceCurrency: null,
  today: '2026-10-21',
  nowMs: NOW,
  ...over,
});
const prefs = (over: Partial<FollowUpPrefs> = {}): FollowUpPrefs => ({ ...DEFAULT_PREFS, ...over });
const group = (over: Partial<SavedExpenseFacts> = {}) =>
  facts({
    scope: 'group',
    groupId: 'g-goa',
    groupName: 'Goa trip',
    members,
    splitParticipantCount: 3,
    ...over,
  });
const ask = (
  expense = facts(),
  h = history(),
  extra: {
    prefs?: FollowUpPrefs;
    session?: FollowUpSession;
    env?: FollowUpEnvironment;
    exponent?: number;
  } = {},
) =>
  nextFollowUp({ expense, history: h, prefs: prefs(), session: NEW_SESSION, env: env(), ...extra });
const other = (over: Partial<RecentGroupExpense> = {}): RecentGroupExpense => ({
  groupId: 'g-goa',
  expenseId: 'other',
  byOther: true,
  authorName: 'Ravi',
  amountMinor: 800000n,
  currency: 'INR',
  description: 'shoes',
  createdMs: NOW - 2 * 3600000,
  ...over,
});
const dupHistory = (over: Partial<RecentGroupExpense> = {}) =>
  history({ recentGroupExpenses: [other(over)] });
const trip = (over: Partial<TripInfo> = {}): TripInfo => ({
  groupId: 'g-goa',
  name: 'Goa trip',
  startDate: '2026-10-17',
  endDate: '2026-10-22',
  quietDays: 0,
  ...over,
});
const med = history({ byCurrency: { INR: { median: 100000n, count: 5 } } });
const rent = (over: Partial<SavedExpenseFacts> = {}) =>
  facts({
    description: 'Rent',
    category: 'home',
    amountMinor: 1500000n,
    date: '2026-10-05',
    ...over,
  });
const past = (date: string, over = {}) => ({
  description: 'Rent',
  amountMinor: 1500000n,
  currency: 'INR',
  date,
  ...over,
});
const rentHistory = (over: Partial<HistoryStats> = {}) =>
  history({ pastPersonal: [past('2026-08-05'), past('2026-09-05')], ...over });
const partner = (name: string, count: number) => ({
  memberId: `m-${name}`,
  groupId: 'g-goa',
  name,
  count,
});

describe('scorer rule contract', () => {
  it('SC-GATE-01 disabled suppresses even duplicates', () => {
    expect(ask(group(), dupHistory(), { prefs: prefs({ enabled: false }) })).toBeNull();
    expect(
      ask(facts(), history(), {
        prefs: prefs({ enabled: false }),
        env: env({ currentPlace: 'Cafe' }),
      }),
    ).toBeNull();
  });
  it('SC-GATE-02 stopped session suppresses duplicates', () => {
    expect(ask(group(), dupHistory(), { session: { ...NEW_SESSION, stopped: true } })).toBeNull();
  });
  it('SC-GATE-03 MAX_QUESTIONS caps the chain', () => {
    const asked = ['place', 'payment'] as const;
    expect(asked).toHaveLength(MAX_QUESTIONS);
    expect(ask(group(), dupHistory(), { session: { ...NEW_SESSION, asked } })).toBeNull();
  });
  it('SC-GATE-04 two consecutive skips suppress score 100 duplicate', () => {
    expect(ask(group(), dupHistory())?.score).toBe(100);
    expect(
      ask(group(), dupHistory(), { session: { ...NEW_SESSION, consecutiveSkips: 2 } }),
    ).toBeNull();
  });
  it('SC-GATE-05 below median suppresses current place', () => {
    expect(
      ask(facts({ amountMinor: 99999n }), med, { env: env({ currentPlace: 'Cafe' }) }),
    ).toBeNull();
  });
  it('SC-GATE-06 duplicate bypasses small spend', () => {
    expect(ask(group({ amountMinor: 100n }), dupHistory({ amountMinor: 100n }))).toMatchObject({
      kind: 'duplicate',
      score: 100,
    });
  });
  it('SC-GATE-07 four samples use INR floor inclusively', () => {
    const h = history({ byCurrency: { INR: { median: 900000n, count: 4 } } });
    expect(
      ask(facts({ amountMinor: 19900n }), h, { env: env({ currentPlace: 'Cafe' }) }),
    ).toBeNull();
    expect(
      ask(facts({ amountMinor: 20000n }), h, { env: env({ currentPlace: 'Cafe' }) })?.kind,
    ).toBe('place');
  });
  it('SC-GATE-08 unknown floor respects exponent including JPY', () => {
    expect(floorMinor('XYZ', 3)).toBe(5000n);
    expect(floorMinor('JPY', 0)).toBe(5n);
    for (const [currency, exponent, floor] of [
      ['XYZ', 3, 5000n],
      ['JPY', 0, 5n],
    ] as const) {
      expect(
        ask(facts({ currency, amountMinor: floor - 1n, hasPaymentMethod: false }), history(), {
          exponent,
        }),
      ).toBeNull();
      expect(
        ask(facts({ currency, amountMinor: floor, hasPaymentMethod: false }), history(), {
          exponent,
        })?.kind,
      ).toBe('payment');
    }
  });
  it('SC-GATE-09 skip penalty drops marginal score below MIN_SCORE', () => {
    const e = facts({ hasPaymentMethod: false });
    expect(ask(e)?.score).toBe(31);
    expect(ask(e, history(), { prefs: prefs({ skips: { payment: 1 } }) })).toBeNull();
  });
  it('SC-GATE-10 asked kinds never repeat', () => {
    expect(
      ask(group(), dupHistory(), { session: { ...NEW_SESSION, asked: ['duplicate'] } }),
    ).toBeNull();
  });
  it('SC-GATE-11 explicit and automatic mutes suppress candidates', () => {
    for (const p of [prefs({ muted: ['duplicate'] }), prefs({ skips: { duplicate: 3 } })]) {
      expect(ask(group(), dupHistory(), { prefs: p })).toBeNull();
    }
    expect(ask(facts({ category: 'travel' }), med)?.kind).toBe('work');
    expect(
      ask(facts({ category: 'travel' }), med, { prefs: prefs({ skips: { work: 1 } }) }),
    ).toBeNull();
  });
  it('SC-GATE-12 equal date and place scores favor earlier kind', () => {
    expect(FOLLOW_UP_KINDS.indexOf('date')).toBeLessThan(FOLLOW_UP_KINDS.indexOf('place'));
    const e = facts({ category: 'home' });
    expect(ask(e, history({ recentPlaces: ['Cafe'] }))?.score).toBe(45);
    expect(ask(e, history({ recentPlaces: ['Cafe'] }), { env: env({ hour: 2 }) })).toMatchObject({
      kind: 'date',
      score: 45,
    });
  });

  it('SC-DUP-01 other same-group expense within five percent scores 100', () => {
    expect(ask(group({ amountMinor: 840000n }), dupHistory())).toMatchObject({
      kind: 'duplicate',
      score: 100,
      duplicate: other(),
    });
  });
  it('SC-DUP-02 5.1 percent difference is excluded', () => {
    expect(ask(group({ amountMinor: 840800n }), dupHistory())).toBeNull();
  });
  it('SC-DUP-03 old and future timestamps are excluded', () => {
    for (const createdMs of [NOW - 25 * 3600000, NOW + 60000])
      expect(ask(group(), dupHistory({ createdMs }))).toBeNull();
  });
  it('SC-DUP-04 own expense is excluded', () => {
    expect(ask(group(), dupHistory({ byOther: false }))).toBeNull();
  });
  it('SC-DUP-05 another group is excluded', () => {
    expect(ask(group(), dupHistory({ groupId: 'g-flat' }))).toBeNull();
  });
  it('SC-DUP-06 saved expense id is excluded', () => {
    expect(ask(group(), dupHistory({ expenseId: 'mine' }))).toBeNull();
  });
  it('SC-DUP-07 newest eligible candidate wins regardless of order', () => {
    const newest = other({ expenseId: 'new', createdMs: NOW - 1000 });
    for (const recentGroupExpenses of [
      [newest, other()],
      [other(), newest],
    ])
      expect(ask(group(), history({ recentGroupExpenses }))?.duplicate).toEqual(newest);
  });
  it('SC-DUP-08 personal scope excludes duplicate', () => {
    expect(ask(facts(), dupHistory())).toBeNull();
  });
  it('SC-DUP-09 currency matching ignores case', () => {
    expect(ask(group({ currency: 'inr' }), dupHistory())?.kind).toBe('duplicate');
  });

  it('SC-PAY-01 Ravi paid scores 75 and names Ravi', () => {
    expect(ask(group({ description: 'Ravi paid for dinner' }))).toMatchObject({
      kind: 'payer',
      score: 75,
      payer: members[2],
    });
  });
  it('SC-PAY-02 paid Ravi back does not make Ravi payer', () => {
    expect(ask(group({ description: 'paid Ravi back' }))).toBeNull();
  });
  it('SC-PAY-03 dinner by Anu identifies Anu', () => {
    // BUG?: The payment-verb precondition discards "dinner by Anu", despite this spec case.
    expect(ask(group({ description: 'dinner by Anu' }))).toMatchObject({
      kind: 'payer',
      score: 75,
      payer: members[1],
    });
  });
  it('SC-PAY-04 a first name shorter than 2 characters is ignored', () => {
    // The spec text says "(<2 chars after split)"; its "Ra" example is 2 characters, so the
    // rule is asserted at its stated boundary: 1 char ignored, 2 chars (Ra, Om, Jo) accepted.
    expect(
      ask(
        group({
          description: 'R paid',
          members: [members[0]!, { id: 'm-r', name: 'R', isMe: false }],
        }),
      ),
    ).toBeNull();
    expect(
      ask(
        group({
          description: 'Ra paid',
          members: [members[0]!, { id: 'm-ra', name: 'Ra', isMe: false }],
        }),
      )?.kind,
    ).toBe('payer');
  });
  it('SC-PAY-05 existing other payer suppresses question', () => {
    expect(ask(group({ description: 'Ravi paid', payerIsMe: false }))).toBeNull();
  });
  it('SC-PAY-06 personal scope suppresses payer', () => {
    expect(ask(facts({ description: 'Ravi paid', members }))).toBeNull();
  });
  it('SC-PAY-07 regex-special member name is handled safely', () => {
    const anu = { id: 'm-anu', name: 'Anu (home)', isMe: false };
    expect(
      ask(group({ description: 'Anu (home) paid by Anu', members: [members[0]!, anu] }))?.payer,
    ).toEqual(anu);
    // The detector deliberately matches the first name token, not the full display name.
    const special = { ...anu, name: 'A.nu (home)' };
    expect(ask(group({ description: 'A.nu paid', members: [special] }))?.payer).toEqual(special);
    expect(ask(group({ description: 'Axnu paid', members: [special] }))).toBeNull();
  });

  it('SC-DATE-01 yesterday words score 70 and suggest previous day', () => {
    expect(ask(facts({ description: 'late night snack yesterday' }))).toMatchObject({
      kind: 'date',
      score: 70,
      suggestedDate: '2026-10-20',
    });
  });
  it('SC-DATE-02 early hour scores 45 but four am is silent', () => {
    expect(ask(facts(), history(), { env: env({ hour: 2 }) })).toMatchObject({
      kind: 'date',
      score: 45,
      suggestedDate: '2026-10-20',
    });
    expect(ask(facts(), history(), { env: env({ hour: 4 }) })).toBeNull();
  });
  it('SC-DATE-03 already backdated expense is silent', () => {
    expect(
      ask(facts({ date: '2026-10-20', description: 'yesterday' }), history(), {
        env: env({ hour: 2 }),
      }),
    ).toBeNull();
  });
  it('SC-DATE-04 yday abbreviation matches', () => {
    expect(ask(facts({ description: 'snack yday' }))).toMatchObject({
      kind: 'date',
      score: 70,
      suggestedDate: '2026-10-20',
    });
  });

  it('SC-LEND-01 gave money to Ravi scores 62', () => {
    expect(ask(facts({ description: 'gave 5000 to Ravi' }))).toMatchObject({
      kind: 'lend',
      person: 'Ravi',
      score: 62,
    });
  });
  it('SC-LEND-02 lent Priya identifies person', () => {
    expect(ask(facts({ description: 'lent Priya' }))).toMatchObject({
      kind: 'lend',
      person: 'Priya',
    });
  });
  it('SC-LEND-03 office is not a person', () => {
    expect(ask(facts({ description: 'gave to the office' }))).toBeNull();
  });
  it('SC-LEND-04 capitalized for Anu works without verb but lunch does not', () => {
    expect(ask(facts({ description: 'for Anu' }))).toMatchObject({ kind: 'lend', person: 'Anu' });
    expect(ask(facts({ description: 'for lunch' }))).toBeNull();
  });
  it('SC-LEND-05 group scope suppresses lend', () => {
    expect(ask(group({ description: 'gave 5000 to Ravi' }))).toBeNull();
  });
  it('SC-LEND-06 recharge is not a person', () => {
    expect(ask(facts({ description: 'sent 200 for recharge' }))).toBeNull();
  });

  it('SC-CUR-01 INR personal in AED scores 60', () => {
    expect(ask(facts(), history(), { env: env({ deviceCurrency: 'AED' }) })).toMatchObject({
      kind: 'currency',
      score: 60,
      currency: 'AED',
    });
  });
  it('SC-CUR-02 matching device currency is silent', () => {
    expect(ask(facts(), history(), { env: env({ deviceCurrency: 'INR' }) })).toBeNull();
  });
  it('SC-CUR-03 group scope suppresses currency', () => {
    expect(ask(group(), history(), { env: env({ deviceCurrency: 'AED' }) })).toBeNull();
  });
  it('SC-CUR-04 unknown device currency is silent', () => {
    expect(ask(facts(), history(), { env: env({ deviceCurrency: null }) })).toBeNull();
  });
  it('SC-CUR-05 lowercase device code is normalized', () => {
    expect(ask(facts(), history(), { env: env({ deviceCurrency: 'aed' }) }))?.toMatchObject({
      kind: 'currency',
      currency: 'AED',
    });
  });

  it('SC-TRIP-01 active trip scores 55 or 75 for cab', () => {
    const h = history({ trips: [trip()] });
    expect(ask(facts(), h)).toMatchObject({ kind: 'trip', score: 55, trip: trip() });
    expect(ask(facts({ description: 'cab' }), h)).toMatchObject({ kind: 'trip', score: 75 });
  });
  it('SC-TRIP-02 start boundary and open end are respected', () => {
    expect(ask(facts({ date: '2026-10-16' }), history({ trips: [trip()] }))).toBeNull();
    expect(
      ask(facts({ date: '2026-12-01' }), history({ trips: [trip({ endDate: null })] }))?.kind,
    ).toBe('trip');
  });
  it('SC-TRIP-03 group scope suppresses trip move', () => {
    expect(ask(group(), history({ trips: [trip()] }))).toBeNull();
  });
  it('SC-WRAP-01 ended group trip scores 58', () => {
    expect(ask(group(), history({ trips: [trip({ endDate: '2026-10-20' })] }))).toMatchObject({
      kind: 'wrapup',
      score: 58,
    });
  });
  it('SC-WRAP-02 five quiet days qualifies but four does not', () => {
    expect(ask(group(), history({ trips: [trip({ quietDays: 5 })] }))).toMatchObject({
      kind: 'wrapup',
      score: 58,
    });
    expect(ask(group(), history({ trips: [trip({ quietDays: 4 })] }))).toBeNull();
  });
  it('SC-WRAP-03 shown trip is suppressed', () => {
    expect(
      ask(group(), history({ trips: [trip({ endDate: '2026-10-20' })] }), {
        prefs: prefs({ wrapUpShown: ['g-goa'] }),
      }),
    ).toBeNull();
  });
  it('SC-WRAP-04 personal scope suppresses wrapup', () => {
    expect(ask(facts(), history({ trips: [trip({ endDate: '2026-10-20' })] }))).toBeNull();
  });

  it('SC-REC-01 Rent in two earlier months scores 52 on day five', () => {
    expect(ask(rent(), rentHistory())).toMatchObject({
      kind: 'recurring',
      score: 52,
      dayOfMonth: 5,
    });
  });
  it('SC-REC-02 one earlier month is insufficient', () => {
    expect(ask(rent(), rentHistory({ pastPersonal: [past('2026-09-05')] }))).toBeNull();
  });
  it('SC-REC-03 amount eleven percent off does not count', () => {
    expect(ask(rent({ amountMinor: 1665000n }), rentHistory())).toBeNull();
  });
  it('SC-REC-04 day gaps of three and month wrap count but four does not', () => {
    expect(
      ask(rent(), rentHistory({ pastPersonal: [past('2026-08-01'), past('2026-09-01')] })),
    ).toBeNull();
    expect(
      ask(rent(), rentHistory({ pastPersonal: [past('2026-08-02'), past('2026-09-02')] }))
        ?.dayOfMonth,
    ).toBe(5);
    expect(
      ask(
        rent({ date: '2026-10-01' }),
        rentHistory({ pastPersonal: [past('2026-07-31'), past('2026-08-31')] }),
      )?.dayOfMonth,
    ).toBe(1);
  });
  it('SC-REC-05 existing normalized rule suppresses repeat', () => {
    expect(ask(rent(), rentHistory({ recurringRules: ['rent'] }))).toBeNull();
  });
  it('SC-REC-06 same month entries do not supply earlier months', () => {
    expect(
      ask(
        rent(),
        rentHistory({ pastPersonal: [past('2026-09-05'), past('2026-10-01'), past('2026-10-02')] }),
      ),
    ).toBeNull();
  });
  it('SC-REC-07 group scope suppresses recurring', () => {
    expect(ask(group({ ...rent(), scope: 'group', groupId: 'g-goa' }), rentHistory())).toBeNull();
  });
  it('SC-REC-08 normalization removes numbers and punctuation but retains month words', () => {
    // Document current behavior: Oct is retained, so "RENT - Oct" differs from "rent".
    expect(normaliseDescription('RENT - Oct')).toBe('rent oct');
    expect(ask(rent({ description: 'RENT - Oct' }), rentHistory())).toBeNull();
    expect(ask(rent({ description: 'RENT - 2026!!' }), rentHistory()))?.toMatchObject({
      kind: 'recurring',
      dayOfMonth: 5,
    });
  });

  it('SC-ATT-01 food split among all four members scores 48', () => {
    const four = [...members, { id: 'm-guest', name: 'Guest', isMe: false }];
    expect(ask(group({ category: 'food', members: four, splitParticipantCount: 4 }))).toMatchObject(
      { kind: 'attendance', score: 48 },
    );
  });
  it('SC-ATT-02 two-member groups do not ask attendance', () => {
    expect(
      ask(group({ category: 'food', members: members.slice(0, 2), splitParticipantCount: 2 })),
    ).toBeNull();
  });
  it('SC-ATT-03 three of four split suppresses attendance', () => {
    expect(
      ask(
        group({
          category: 'food',
          members: [...members, { id: 'm-guest', name: 'Guest', isMe: false }],
          splitParticipantCount: 3,
        }),
      ),
    ).toBeNull();
  });
  it('SC-ATT-04 travel suppresses attendance', () => {
    expect(ask(group({ category: 'travel' }))).toBeNull();
  });

  it('SC-PLC-01 current food place at lunch scores 85', () => {
    expect(
      ask(facts({ category: 'food' }), history(), { env: env({ currentPlace: 'Cafe', hour: 13 }) }),
    ).toMatchObject({ kind: 'place', score: 85, hereNow: true, places: ['Cafe'] });
  });
  it('SC-PLC-02 recent places cap at three without here', () => {
    expect(
      ask(facts({ category: 'food' }), history({ recentPlaces: ['A', 'B', 'C', 'D'] })),
    ).toMatchObject({ kind: 'place', score: 55, hereNow: false, places: ['A', 'B', 'C'] });
  });
  it('SC-PLC-03 recents dedupe the current place', () => {
    expect(
      ask(facts(), history({ recentPlaces: ['Cafe', 'Gym', 'Cafe'] }), {
        env: env({ currentPlace: 'Cafe' }),
      })?.places,
    ).toEqual(['Cafe', 'Gym']);
  });
  it('SC-PLC-04 existing place suppresses question', () => {
    expect(
      ask(facts({ hasPlace: true }), history({ recentPlaces: ['Cafe'] }), {
        env: env({ currentPlace: 'Mall' }),
      }),
    ).toBeNull();
  });
  it('SC-PLC-05 no places suppresses question', () => {
    expect(ask()).toBeNull();
  });
  it('SC-PLC-06 current place precedes two recents', () => {
    expect(
      ask(facts(), history({ recentPlaces: ['A', 'B', 'C'] }), {
        env: env({ currentPlace: 'Here' }),
      })?.places,
    ).toEqual(['Here', 'A', 'B']);
  });

  it('SC-CAT-01 uncertain category scores 42 with favorites excluding current and other', () => {
    expect(
      ask(
        facts({ category: 'shopping', categoryStated: false, description: 'zzz' }),
        history({ topCategories: ['health', 'other', 'shopping', 'groceries'] }),
      ),
    ).toMatchObject({ kind: 'category', score: 42, categories: ['health', 'groceries', 'food'] });
  });
  it('SC-CAT-02 stated category suppresses question', () => {
    expect(ask(facts({ categoryStated: true, description: 'zzz' }))).toBeNull();
  });
  it('SC-CAT-03 confident food guess suppresses question', () => {
    expect(ask(facts({ category: null, categoryStated: false, description: 'pizza' }))).toBeNull();
  });

  it('SC-RCP-01 travel group at five times median scores 80', () => {
    expect(
      ask(group({ category: 'travel', canAttachReceipt: true, amountMinor: 500000n }), med),
    ).toMatchObject({ kind: 'receipt', score: 80 });
  });
  it('SC-RCP-02 two and three times reference add 14 and 28', () => {
    expect(
      ask(group({ category: 'travel', canAttachReceipt: true, amountMinor: 200000n }), med),
    ).toMatchObject({ kind: 'receipt', score: 54 });
    expect(
      ask(group({ category: 'travel', canAttachReceipt: true, amountMinor: 300000n }), med),
    ).toMatchObject({ kind: 'receipt', score: 68 });
  });
  it('SC-RCP-03 existing receipt or inability to attach suppresses receipt', () => {
    expect(ask(group({ canAttachReceipt: true, hasReceipt: true }))).toBeNull();
    expect(ask(facts({ amountMinor: 90000000n, canAttachReceipt: false }))).toBeNull();
  });
  it('SC-RCP-04 no history uses INR floor as receipt reference', () => {
    expect(
      ask(group({ category: 'travel', amountMinor: 100000n, canAttachReceipt: true })),
    ).toMatchObject({ kind: 'receipt', score: 80 });
  });

  it('SC-SPL-01 frequent food partners score 75 and retain top three order', () => {
    // HistoryStats supplies partners sorted by count, as buildHistoryStats guarantees.
    const partners = [
      partner('Ravi', 5),
      partner('Anu', 4),
      partner('Sam', 3),
      partner('Priya', 2),
    ];
    expect(
      ask(facts({ category: 'food' }), history({ partnersByCategory: { food: partners } })),
    ).toMatchObject({ kind: 'split', score: 75, partners: partners.slice(0, 3) });
  });
  it('SC-SPL-02 one-off partners are filtered', () => {
    expect(
      ask(
        facts({ category: 'food' }),
        history({ partnersByCategory: { food: [partner('Ravi', 1)] } }),
      ),
    ).toBeNull();
  });
  it('SC-SPL-03 group scope suppresses split', () => {
    expect(
      ask(group(), history({ partnersByCategory: { shopping: [partner('Ravi', 5)] } })),
    ).toBeNull();
  });
  it('SC-PAYM-01 missing storable method scores 31 and filled method suppresses', () => {
    expect(ask(facts({ hasPaymentMethod: false }))).toMatchObject({ kind: 'payment', score: 31 });
    expect(ask(facts({ hasPaymentMethod: true }))).toBeNull();
    expect(ask(facts({ hasPaymentMethod: false, canSetPayment: false }))).toBeNull();
  });
  it('SC-WORK-01 work requires amount strictly above trusted median', () => {
    expect(ask(facts({ category: 'travel', amountMinor: 100001n }), med)).toMatchObject({
      kind: 'work',
      score: 32,
    });
    expect(ask(facts({ category: 'travel', amountMinor: 100000n }), med)).toBeNull();
    expect(ask(facts({ category: 'travel', amountMinor: 99999n }), med)).toBeNull();
    expect(ask(facts({ category: 'travel' }))).toBeNull();
  });
  it('SC-WORK-02 group notes suppress work question', () => {
    expect(ask(group({ category: 'travel', hasNotes: true }), med)).toBeNull();
  });
  it('SC-WORK-03 hotel words qualify with null category', () => {
    expect(ask(facts({ category: null, description: 'hotel' }), med)).toMatchObject({
      kind: 'work',
      score: 32,
    });
  });

  it('SC-DET-01 identical inputs yield identical output one hundred times', () => {
    const e = group({ category: 'food', description: 'Ravi paid for dinner' });
    const h = dupHistory();
    const extra = { env: env({ currentPlace: 'Cafe', hour: 13 }) };
    const expected = ask(e, h, extra);
    expect(expected).toMatchObject({ kind: 'duplicate', score: 100 });
    for (let i = 0; i < 100; i++) expect(ask(e, h, extra)).toEqual(expected);
  });
  it('SC-DET-02 generated results respect score and exclusion invariants', () => {
    fc.assert(
      fc.property(
        fc.record({
          amount: fc.bigInt({ min: 0n, max: 10000000n }),
          median: fc.bigInt({ min: 1n, max: 10000000n }),
          count: fc.integer({ min: 0, max: 20 }),
          scope: fc.constantFrom('personal' as const, 'group' as const),
          category: fc.constantFrom(null, 'food', 'travel', 'shopping', 'home'),
          description: fc.constantFrom('Ravi paid', 'hotel', 'gave to Anu', 'yesterday', 'zzz'),
          asked: fc.subarray([...FOLLOW_UP_KINDS]),
          muted: fc.subarray([...FOLLOW_UP_KINDS]),
          hour: fc.integer({ min: 0, max: 23 }),
          here: fc.boolean(),
          receipt: fc.boolean(),
          payment: fc.boolean(),
          skips: fc.integer({ min: 0, max: 2 }),
        }),
        (v) => {
          const q = ask(
            (v.scope === 'group' ? group : facts)({
              amountMinor: v.amount,
              category: v.category,
              description: v.description,
              canAttachReceipt: v.receipt,
              hasPaymentMethod: v.payment,
            }),
            history({
              byCurrency: { INR: { median: v.median, count: v.count } },
              recentPlaces: ['Cafe'],
              recentGroupExpenses: [other()],
              trips: [trip()],
              partnersByCategory: { food: [partner('Ravi', 5)] },
            }),
            {
              prefs: prefs({ muted: v.muted, skips: { place: v.skips, payment: v.skips } }),
              session: { ...NEW_SESSION, asked: v.asked },
              env: env({ hour: v.hour, currentPlace: v.here ? 'Here' : null }),
            },
          );
          if (q !== null) {
            expect(q.score).toBeGreaterThanOrEqual(MIN_SCORE);
            expect(v.asked).not.toContain(q.kind);
            expect(v.muted).not.toContain(q.kind);
          }
        },
      ),
      { seed: 20261021, numRuns: 300 },
    );
  });
});
