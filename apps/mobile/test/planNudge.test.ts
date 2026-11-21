import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersonalRecurring, PersonalTxn } from '@waves/core';

import { STRINGS_BY_LANGUAGE } from '@/i18n';
import {
  lastThreeUnopened,
  planNudges,
  type PlanHistory,
  type PlanItem,
  type PlanNudgeInput,
} from '@/lib/planNudge/plan';
import { syncPlanNudges } from '@/lib/planNudge/run';
import { planNudgeText } from '@/lib/planNudge/render';
import {
  loadPlanHistory,
  loadPlanPrefs,
  recordPlanOpened,
  recordPlanScheduled,
  savePlanPref,
} from '@/lib/planNudge/settings';

const os = vi.hoisted(() => ({
  held: [] as { identifier: string; content: { data: Record<string, unknown> } }[],
  allowed: true,
}));
vi.mock('@/lib/push', () => ({
  ensureAndroidChannel: vi.fn(),
  localNotificationsAllowed: async () => os.allowed,
  pushSupported: true,
}));
vi.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  getAllScheduledNotificationsAsync: async () => os.held,
  cancelScheduledNotificationAsync: async (id: string) => {
    os.held = os.held.filter((r) => r.identifier !== id);
  },
  scheduleNotificationAsync: async (req: { content: { data: Record<string, unknown> } }) => {
    os.held.push({ identifier: `n${os.held.length}`, content: req.content });
    return 'x';
  },
}));

const txn = (o: Partial<PersonalTxn>): PersonalTxn => ({
  id: Math.random().toString(36),
  kind: o.kind ?? 'expense',
  amount: o.amount ?? 0n,
  currency: 'INR',
  category: null,
  note: null,
  date: o.date ?? '2026-11-10',
  loanId: null,
  recurringId: null,
});
const rule = (o: Partial<PersonalRecurring>): PersonalRecurring => ({
  id: o.id ?? 'r',
  txnKind: 'expense',
  amount: o.amount ?? 18_000_00n,
  currency: 'INR',
  category: null,
  note: o.note ?? 'Rent',
  cadence: 'monthly',
  interval: 1,
  secondDay: null,
  anchorDate: '2026-01-05',
  nextDate: o.nextDate ?? '2026-11-25',
  endDate: null,
  autoPost: false,
  active: true,
});

// Wed 2026-11-18 10:00 local. Sunday is the 22nd, the 1st of December is a Tuesday.
const now = new Date(2026, 10, 18, 10, 0).getTime();
const history: PlanHistory = { scheduled: [], opened: [] };
const ledger = [
  txn({ kind: 'income', amount: 100_000_00n, date: '2026-11-01' }),
  txn({ amount: 6_200_00n, date: '2026-11-17' }),
  txn({ amount: 4_000_00n, date: '2026-11-03' }),
];
const input = (o: Partial<PlanNudgeInput> = {}): PlanNudgeInput => ({
  now,
  txns: ledger,
  recurrings: [],
  budgets: [],
  currency: 'INR',
  prefs: { bills: true, recap: true, daily: false },
  history,
  textKey: 'en|0',
  ...o,
});
const at = (d: number, h: number, m = 10): number => new Date(2026, m, d, h).getTime();
const kinds = (items: PlanItem[]): string[] =>
  items.map((i) => `${i.kind}@${new Date(i.fireAt).getDate()}`);

describe('planNudges', () => {
  it('sets a bill reminder for 19:00 the evening before', () => {
    const items = planNudges(input({ recurrings: [rule({ nextDate: '2026-11-25' })] }));
    const bill = items.find((i) => i.kind === 'bill')!;
    expect(bill.fireAt).toBe(at(24, 19));
    expect(bill).toMatchObject({ amount: 18_000_00n, covered: true });
  });

  it('adds the weekly recap on Sunday 19:00, only when something was spent', () => {
    expect(planNudges(input()).map((i) => i.fireAt)).toEqual([at(22, 19)]);
    expect(planNudges(input({ txns: [] }))).toEqual([]);
  });

  it("the monthly recap on the 1st replaces that Sunday's weekly", () => {
    // Sunday 1 Feb 2026 is both a week end and the 1st.
    const jan = new Date(2026, 0, 28, 10, 0).getTime();
    const txns = [
      txn({ kind: 'income', amount: 50_000_00n, date: '2026-01-02' }),
      txn({ amount: 1_000_00n, date: '2026-01-27' }),
    ];
    const items = planNudges(input({ now: jan, txns }));
    expect(items.map((i) => i.kind)).toEqual(['month']);
    expect(items[0]).toMatchObject({ month: '2026-01', url: 'waves://personal/recap?kind=month' });
    expect(items[0]!.fireAt).toBe(new Date(2026, 1, 1, 10).getTime());
  });

  it('keeps at most one a day: the bill beats the recap and the daily', () => {
    const items = planNudges(
      input({
        recurrings: [rule({ nextDate: '2026-11-23' })],
        prefs: { bills: true, recap: true, daily: true },
        now: new Date(2026, 10, 22, 8, 0).getTime() - 1,
      }),
    );
    expect(kinds(items)).toEqual(['bill@22']);
  });

  it('caps bills at two a week and exempts the daily', () => {
    const items = planNudges(
      input({
        recurrings: [
          rule({ id: 'a', nextDate: '2026-11-21' }),
          rule({ id: 'b', nextDate: '2026-11-22' }),
          rule({ id: 'c', nextDate: '2026-11-23' }),
        ],
        prefs: { bills: true, recap: true, daily: true },
      }),
    );
    expect(items.filter((i) => i.kind === 'bill')).toHaveLength(2);
    expect(items.filter((i) => i.kind === 'week')).toHaveLength(1);
    expect(items.filter((i) => i.kind === 'daily')).toHaveLength(1);
  });

  it('only sends daily when opted in, as the next 09:00, with the amount left', () => {
    const items = planNudges(input({ prefs: { bills: false, recap: false, daily: true } }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'daily', fireAt: at(19, 9) });
  });

  it('stays inside 08:00-21:00 and within seven days', () => {
    const items = planNudges(
      input({
        recurrings: [rule({ nextDate: '2026-11-19' }), rule({ id: 'x', nextDate: '2026-11-30' })],
        prefs: { bills: true, recap: true, daily: true },
      }),
    );
    for (const i of items) {
      const h = new Date(i.fireAt).getHours();
      expect(h >= 8 && h <= 21).toBe(true);
      expect(i.fireAt).toBeGreaterThan(now);
      expect(i.fireAt).toBeLessThanOrEqual(now + 7 * 86_400_000);
    }
  });

  it('says nothing for a bill that is past, ended or not an expense', () => {
    const items = planNudges(
      input({
        txns: [],
        recurrings: [
          rule({ id: 'p', nextDate: '2026-11-18' }),
          { ...rule({ id: 'i', nextDate: '2026-11-25' }), txnKind: 'income' },
          { ...rule({ id: 'e', nextDate: '2026-11-25' }), endDate: '2026-11-20' },
        ],
      }),
    );
    expect(items).toEqual([]);
  });

  it('falls back to recaps when the last three delivered were never opened', () => {
    const sent = [at(10, 19), at(11, 19), at(12, 19)];
    const ignored: PlanHistory = { scheduled: sent, opened: [] };
    expect(lastThreeUnopened(ignored, now)).toBe(true);
    expect(lastThreeUnopened({ scheduled: sent, opened: [sent[1]!] }, now)).toBe(false);
    expect(lastThreeUnopened({ scheduled: [...sent, at(25, 19)], opened: [] }, now)).toBe(true);
    const items = planNudges(
      input({
        recurrings: [rule({ nextDate: '2026-11-25' })],
        prefs: { bills: true, recap: true, daily: true },
        history: ignored,
      }),
    );
    expect(kinds(items)).toEqual(['week@22']);
  });

  it('plans nothing when every switch is off', () => {
    expect(planNudges(input({ prefs: { bills: false, recap: false, daily: false } }))).toEqual([]);
  });
});

describe('planNudgeText', () => {
  const ctx = (lang: 'en' | 'ar', hidden: boolean) => ({
    s: STRINGS_BY_LANGUAGE[lang].notifications.plan,
    hidden,
    fmt: (n: bigint) => `₹${n / 100n}`,
    categoryName: () => 'Other',
    monthName: () => 'October',
  });
  const items = planNudges(
    input({
      recurrings: [rule({ nextDate: '2026-11-25' })],
      prefs: { bills: true, recap: true, daily: true },
    }),
  );

  it('writes the amounts, and no amounts when hidden', () => {
    const bill = items.find((i) => i.kind === 'bill')!;
    expect(planNudgeText(bill, ctx('en', false)).body).toBe(
      "Rent of ₹18000 goes out tomorrow. You're covered.",
    );
    for (const item of items) {
      for (const lang of ['en', 'ar'] as const) {
        expect(planNudgeText(item, ctx(lang, false)).body).not.toMatch(/\{/);
        expect(planNudgeText(item, ctx(lang, true)).body).not.toMatch(/₹|\d/);
      }
    }
  });

  it('words the weekly and monthly recaps', () => {
    const week: PlanItem = {
      kind: 'week',
      id: 'w',
      fireAt: 1,
      url: '',
      spent: 6200_00n,
      delta: -900_00n,
    };
    expect(planNudgeText(week, ctx('en', false)).body).toBe(
      'Your week: ₹6200 spent, ₹900 less than usual. Tap to see.',
    );
    const month: PlanItem = {
      kind: 'month',
      id: 'm',
      fireAt: 1,
      url: '',
      month: '2026-10',
      leftOver: 9400_00n,
    };
    expect(planNudgeText(month, ctx('en', false)).body).toBe(
      'October closed with ₹9400 left over.',
    );
  });
});

describe('plan nudge settings', () => {
  it('defaults bills and recap on, daily off, and remembers history per owner', async () => {
    expect(await loadPlanPrefs('o1')).toEqual({ bills: true, recap: true, daily: false });
    await savePlanPref('o1', 'daily', true);
    expect((await loadPlanPrefs('o1')).daily).toBe(true);
    expect((await loadPlanPrefs('o2')).daily).toBe(false);
    await recordPlanScheduled('o1', [3, 1, 2]);
    await recordPlanOpened('o1', 2);
    expect(await loadPlanHistory('o1')).toEqual({ scheduled: [1, 2, 3], opened: [2] });
    expect(await loadPlanHistory('o2')).toEqual({ scheduled: [], opened: [] });
  });
});

describe('syncPlanNudges', () => {
  const run = (ownerId = 'u1') =>
    syncPlanNudges({ ...input(), ownerId, text: () => ({ title: 't', body: 'b' }) });
  beforeEach(() => {
    os.held = [];
    os.allowed = true;
  });

  it('schedules the plan, keeps it on a repeat, and never without permission', async () => {
    await run();
    expect(os.held.map((r) => r.content.data.key)).toEqual(['waves.plan.nudge']);
    const first = os.held[0]!.identifier;
    await run();
    expect(os.held[0]!.identifier).toBe(first);
    os.allowed = false;
    await run();
    expect(os.held).toEqual([]);
  });

  it('leaves other notifications alone and does nothing signed out', async () => {
    os.held = [{ identifier: 'other', content: { data: { key: 'waves.captures.nudge' } } }];
    await run('');
    await run();
    expect(os.held.map((r) => r.identifier)).toContain('other');
  });
});
