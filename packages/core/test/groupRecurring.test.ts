import { describe, expect, it } from 'vitest';

import {
  Frequency,
  MutationKind,
  SyncTable,
  buildGroupRecurringCreate,
  emptyMirror,
  groupRecurringFromRow,
  materialiseGroupRecurring,
  reconcile,
  schedulePatch,
  templatePatch,
  type QueuedMutation,
  RECURRING_CATCH_UP_CAP,
  canChangeRecurringStatus,
  recurringDisplayStatus,
  editFromRule,
  recurringEditProblem,
  recurringFullPatch,
  type GroupRecurringRule,
  rescalePayers,
  dueOccurrences,
  firstOccurrenceOnOrAfter,
  frequencyOf,
  isGroupRecurringDue,
  nextOccurrenceAfter,
  resumeNextDate,
  scheduleFor,
  type GroupSchedule,
} from '../src';

const monthly = (anchorDate: string, interval = 1): GroupSchedule => ({
  ...scheduleFor(Frequency.Monthly),
  interval,
  anchorDate,
});

const walk = (schedule: GroupSchedule, count: number): string[] => {
  const out: string[] = [schedule.anchorDate];
  while (out.length < count) out.push(nextOccurrenceAfter(schedule, out[out.length - 1]!));
  return out;
};

describe('group recurring: month arithmetic (RC-01..RC-06)', () => {
  it('RC-01 2026-01-31 -> 2026-02-28', () => {
    expect(nextOccurrenceAfter(monthly('2026-01-31'), '2026-01-31')).toBe('2026-02-28');
  });
  it('RC-02 2028-01-31 -> 2028-02-29 (leap year)', () => {
    expect(nextOccurrenceAfter(monthly('2028-01-31'), '2028-01-31')).toBe('2028-02-29');
  });
  it('RC-03 2028-02-29 -> 2028-03-29', () => {
    expect(nextOccurrenceAfter(monthly('2028-02-29'), '2028-02-29')).toBe('2028-03-29');
  });
  it('RC-04 2026-03-31 -> 2026-04-30', () => {
    expect(nextOccurrenceAfter(monthly('2026-03-31'), '2026-03-31')).toBe('2026-04-30');
  });
  it('RC-05 2026-12-15 -> 2027-01-15 (year roll)', () => {
    expect(nextOccurrenceAfter(monthly('2026-12-15'), '2026-12-15')).toBe('2027-01-15');
  });
  it('RC-06 2026-10-05 -> 2026-11-05', () => {
    expect(nextOccurrenceAfter(monthly('2026-10-05'), '2026-10-05')).toBe('2026-11-05');
  });
});

describe('group recurring: anchor memory and other cadences', () => {
  it('RC-07 a rule anchored on the 31st fires 31, 28, 31, 30, 31 and never sticks on 28', () => {
    expect(walk(monthly('2026-01-31'), 6)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('RC-07b the 31st -> 29 (leap) -> 31 round trip', () => {
    expect(walk(monthly('2028-01-31'), 4)).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
      '2028-04-30',
    ]);
  });

  it('RC-08 semimonthly anchor 1 + second day 15; second day 31 clamps in February', () => {
    const mid = {
      ...scheduleFor(Frequency.TwiceAMonth, { secondDay: 15 }),
      anchorDate: '2026-01-01',
    };
    expect(walk(mid, 5)).toEqual([
      '2026-01-01',
      '2026-01-15',
      '2026-02-01',
      '2026-02-15',
      '2026-03-01',
    ]);
    const end = {
      ...scheduleFor(Frequency.TwiceAMonth, { secondDay: 31 }),
      anchorDate: '2026-01-01',
    };
    expect(walk(end, 5)).toEqual([
      '2026-01-01',
      '2026-01-31',
      '2026-02-01',
      '2026-02-28',
      '2026-03-01',
    ]);
    const endLeap = {
      ...scheduleFor(Frequency.TwiceAMonth, { secondDay: 31 }),
      anchorDate: '2028-02-01',
    };
    expect(walk(endLeap, 2)).toEqual(['2028-02-01', '2028-02-29']);
  });

  it('RC-09 fortnightly from a Sunday stays on Sundays across both DST changes', () => {
    const schedule = { ...scheduleFor(Frequency.Fortnightly), anchorDate: '2026-03-15' };
    const dates = walk(schedule, 12);
    for (const date of dates) expect(new Date(`${date}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(dates).toContain('2026-03-29');
    // exactly 14 days apart, whatever the local clocks did
    for (let i = 1; i < dates.length; i += 1) {
      const gap = (Date.parse(dates[i]!) - Date.parse(dates[i - 1]!)) / 86_400_000;
      expect(gap).toBe(14);
    }
    const us = { ...scheduleFor(Frequency.Fortnightly), anchorDate: '2026-10-18' };
    expect(walk(us, 3)).toEqual(['2026-10-18', '2026-11-01', '2026-11-15']);
  });

  it.each([
    ['quarterly', Frequency.Quarterly, ['2028-02-29', '2028-05-29', '2028-08-29']],
    ['half-yearly', Frequency.HalfYearly, ['2028-02-29', '2028-08-29', '2029-02-28']],
    [
      'yearly',
      Frequency.Yearly,
      ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'],
    ],
  ] as const)(
    'RC-10 %s from Feb 29 lands on Feb 28 in non-leap years',
    (_n, frequency, expected) => {
      const schedule = { ...scheduleFor(frequency), anchorDate: '2028-02-29' };
      expect(walk(schedule, expected.length)).toEqual(expected);
    },
  );

  it('every-N-months keeps the anchor day', () => {
    const schedule = {
      ...scheduleFor(Frequency.EveryNMonths, { interval: 5 }),
      anchorDate: '2026-01-31',
    };
    expect(walk(schedule, 4)).toEqual(['2026-01-31', '2026-06-30', '2026-11-30', '2027-04-30']);
  });

  it('a date before the anchor gives the anchor; far past the anchor is exact', () => {
    const schedule = monthly('2026-03-31');
    expect(nextOccurrenceAfter(schedule, '2025-01-01')).toBe('2026-03-31');
    expect(nextOccurrenceAfter(schedule, '2030-06-15')).toBe('2030-06-30');
    expect(nextOccurrenceAfter(schedule, '2030-06-30')).toBe('2030-07-31');
  });

  it('RC-13 malformed dates come back unchanged and never throw', () => {
    expect(nextOccurrenceAfter(monthly('2026-01-31'), 'soon')).toBe('soon');
    expect(nextOccurrenceAfter(monthly('2026-13-01'), '2026-02-01')).toBe('2026-02-01');
    expect(nextOccurrenceAfter(monthly('2026-02-30'), '2026-03-01')).toBe('2026-03-01');
  });

  it('firstOccurrenceOnOrAfter keeps a date that is itself an occurrence', () => {
    const schedule = monthly('2026-01-31');
    expect(firstOccurrenceOnOrAfter(schedule, '2026-02-28')).toBe('2026-02-28');
    expect(firstOccurrenceOnOrAfter(schedule, '2026-02-10')).toBe('2026-02-28');
    expect(firstOccurrenceOnOrAfter(schedule, '2026-03-01')).toBe('2026-03-31');
    expect(firstOccurrenceOnOrAfter(schedule, '2025-01-01')).toBe('2026-01-31');
  });

  it('RC-19..26 frequencyOf round-trips every Frequency through scheduleFor', () => {
    for (const frequency of Object.values(Frequency)) {
      const schedule = scheduleFor(frequency, { interval: 5 });
      expect(frequencyOf(schedule)).toBe(frequency);
    }
  });
});

describe('group recurring: due occurrences', () => {
  const rule = (over: Partial<Parameters<typeof dueOccurrences>[0]> = {}) => ({
    ...monthly('2026-01-31'),
    nextDate: '2026-01-31',
    endDate: null,
    status: 'active' as const,
    ...over,
  });

  it('nothing is due before the next date, one is due on it', () => {
    expect(dueOccurrences(rule(), '2026-01-30').dates).toEqual([]);
    const run = dueOccurrences(rule(), '2026-01-31');
    expect(run.dates).toEqual(['2026-01-31']);
    expect(run.nextDate).toBe('2026-02-28');
  });

  it('RC-11 endDate equal to the occurrence fires; one day before does not', () => {
    const on = dueOccurrences(rule({ endDate: '2026-01-31' }), '2026-03-01');
    expect(on.dates).toEqual(['2026-01-31']);
    expect(on.ended).toBe(true);
    const before = dueOccurrences(rule({ endDate: '2026-01-30' }), '2026-03-01');
    expect(before.dates).toEqual([]);
    expect(before.ended).toBe(true);
  });

  it('catches up every missed occurrence in order', () => {
    const run = dueOccurrences(rule(), '2026-04-15');
    expect(run.dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(run.nextDate).toBe('2026-04-30');
  });

  it('caps a long catch-up and carries the rest to the next run', () => {
    const first = dueOccurrences(
      rule({ nextDate: '2020-01-31', anchorDate: '2020-01-31' }),
      '2026-01-31',
    );
    expect(first.dates).toHaveLength(RECURRING_CATCH_UP_CAP);
    expect(first.dates[0]).toBe('2020-01-31');
    const second = dueOccurrences(
      rule({ nextDate: first.nextDate, anchorDate: '2020-01-31' }),
      '2026-01-31',
    );
    expect(second.dates[0]).toBe(first.nextDate);
  });

  it('a paused or stopped rule owes nothing, and is never due', () => {
    for (const status of ['paused', 'stopped'] as const) {
      expect(dueOccurrences(rule({ status }), '2027-01-01').dates).toEqual([]);
      expect(
        isGroupRecurringDue({ status, nextDate: '2026-01-01', endDate: null }, '2027-01-01'),
      ).toBe(false);
    }
    expect(
      isGroupRecurringDue(
        { status: 'active', nextDate: '2026-01-01', endDate: null },
        '2026-01-01',
      ),
    ).toBe(true);
  });

  it('resuming skips what was missed while paused', () => {
    expect(resumeNextDate(monthly('2026-01-15'), '2026-06-20')).toBe('2026-07-15');
    expect(resumeNextDate(monthly('2026-01-15'), '2026-06-15')).toBe('2026-06-15');
  });

  it('stopped is final', () => {
    expect(canChangeRecurringStatus('active', 'paused')).toBe(true);
    expect(canChangeRecurringStatus('paused', 'active')).toBe(true);
    expect(canChangeRecurringStatus('paused', 'stopped')).toBe(true);
    expect(canChangeRecurringStatus('stopped', 'active')).toBe(false);
  });
});

describe('group recurring: payloads and the offline overlay', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001';
  const B = 'aaaaaaaa-0000-4000-8000-000000000002';
  const C = 'aaaaaaaa-0000-4000-8000-000000000003';
  const GROUP = 'gggggggg-0000-4000-8000-000000000001';
  const template = {
    description: ' Rent ',
    currency: 'INR',
    amount: 100_000n,
    splitParams: { kind: 'equal' } as const,
    participants: [A, B, C],
    payers: { [A]: 100_000n },
  };

  it('builds a create whose payers and shares each sum to the amount, deterministically', () => {
    const one = buildGroupRecurringCreate('rule-1', template, {
      frequency: Frequency.Monthly,
      anchorDate: '2026-11-01',
    });
    const again = buildGroupRecurringCreate('rule-1', template, {
      frequency: Frequency.Monthly,
      anchorDate: '2026-11-01',
    });
    expect(one).toEqual(again);
    const total = (lines: readonly { amount: string }[]) =>
      lines.reduce((sum, line) => sum + BigInt(line.amount), 0n);
    expect(total(one.shares)).toBe(100_000n);
    expect(total(one.payers)).toBe(100_000n);
    expect(one).toMatchObject({
      description: 'Rent',
      cadence: 'monthly',
      interval: 1,
      secondDay: null,
      splitType: 'equal',
      endDate: null,
    });
  });

  it('refuses payers that do not add up, and names the pattern in the schedule', () => {
    expect(() =>
      buildGroupRecurringCreate(
        'r',
        { ...template, payers: { [A]: 5n } },
        { frequency: Frequency.Monthly, anchorDate: '2026-11-01' },
      ),
    ).toThrow(/add up/);
    expect(
      schedulePatch({
        frequency: Frequency.Quarterly,
        anchorDate: '2026-11-01',
        endDate: '2027-11-01',
      }),
    ).toEqual({
      cadence: 'monthly',
      interval: 3,
      second_day: null,
      anchor_date: '2026-11-01',
      end_date: '2027-11-01',
    });
    expect(templatePatch('r', template)).toMatchObject({ amount: '100000', split_type: 'equal' });
  });

  const queued = (seq: number, kind: MutationKind, payload: object): QueuedMutation => ({
    clientMutationId: `m${seq}`,
    kind,
    groupId: GROUP,
    clientCreatedAt: `2026-10-19T10:00:0${seq}.000Z`,
    payload,
    seq,
    attempts: 0,
    nextAttemptAt: 0,
  });

  it('shows a queued create at once, then a queued pause, then the server row replaces it', () => {
    const create = buildGroupRecurringCreate('rule-1', template, {
      frequency: Frequency.Monthly,
      anchorDate: '2026-11-01',
    });
    const queue = [
      queued(1, MutationKind.GroupRecurringCreate, create),
      queued(2, MutationKind.GroupRecurringUpdate, {
        ruleId: 'rule-1',
        patch: { status: 'paused' },
      }),
    ];
    const rules = materialiseGroupRecurring(emptyMirror(), queue, {
      groupId: GROUP,
      myMemberId: A,
    });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      id: 'rule-1',
      status: 'paused',
      created_by: A,
      pending: true,
      next_date: '2026-11-01',
    });

    const server = reconcile(emptyMirror(), [
      {
        table: SyncTable.GroupRecurringExpenses,
        groupId: GROUP,
        seq: 1,
        row: { ...rules[0]!, status: 'active', pending: undefined, id: 'rule-1', group_id: GROUP },
      },
    ]).state;
    const merged = materialiseGroupRecurring(server, [queue[1]!], { groupId: GROUP });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.status).toBe('paused');
  });

  it('a queued resume or schedule edit previews the server date and a stopped rule ignores edits', () => {
    const base = {
      id: 'r',
      group_id: GROUP,
      created_by: A,
      description: 'Rent',
      category: null,
      currency: 'INR',
      amount: '300',
      split_type: 'equal',
      split_params: { kind: 'equal' },
      payers: [{ memberId: A, amount: '300' }],
      shares: [A, B, C].map((memberId) => ({ memberId, amount: '100' })),
      notes: null,
      cadence: 'monthly',
      interval: 1,
      second_day: null,
      anchor_date: '2026-01-15',
      next_date: '2026-02-15',
      end_date: null,
      status: 'paused',
      last_generated_on: null,
      created_at: '2026-01-01T00:00:00Z',
    };
    const state = reconcile(emptyMirror(), [
      { table: SyncTable.GroupRecurringExpenses, groupId: GROUP, seq: 1, row: base },
      {
        table: SyncTable.GroupRecurringExpenses,
        groupId: GROUP,
        seq: 2,
        row: { ...base, id: 's', status: 'stopped' },
      },
    ]).state;
    const resume = materialiseGroupRecurring(
      state,
      [
        queued(1, MutationKind.GroupRecurringUpdate, { ruleId: 'r', patch: { status: 'active' } }),
        queued(2, MutationKind.GroupRecurringUpdate, { ruleId: 's', patch: { status: 'active' } }),
      ],
      { groupId: GROUP, today: '2026-06-20' },
    );
    expect(resume.find((rule) => rule.id === 'r')).toMatchObject({
      status: 'active',
      next_date: '2026-07-15',
    });
    expect(resume.find((rule) => rule.id === 's')!.status).toBe('stopped');
  });

  it('decodes a row into the rule the screens use', () => {
    const rule = groupRecurringFromRow({
      id: 'r',
      group_id: GROUP,
      created_by: A,
      description: 'Rent',
      category: 'rent',
      currency: 'INR',
      amount: '300' as never,
      split_params: { kind: 'equal' },
      payers: [{ memberId: A, amount: '300' }],
      shares: [A, B, C].map((memberId) => ({ memberId, amount: '100' })),
      notes: null,
      cadence: 'monthly',
      interval: 1,
      second_day: null,
      anchor_date: '2026-11-01',
      next_date: '2026-11-01',
      end_date: null,
      status: 'active',
      last_generated_on: null,
    });
    expect(rule.amount).toBe(300n);
    expect(rule.payers).toEqual({ [A]: 300n });
    expect(rule.participants).toEqual([A, B, C]);
    expect(rule.splitParams).toEqual({ kind: 'equal' });
  });
});

describe('group recurring: editing the amount', () => {
  it('a single payer pays all of the new amount', () => {
    expect(rescalePayers({ a: 100n }, 250n)).toEqual({ a: 250n });
  });
  it('several payers keep their proportions and the total is exact', () => {
    const out = rescalePayers({ a: 1n, b: 1n, c: 1n }, 100n);
    expect(Object.values(out).reduce((x, y) => x + y, 0n)).toBe(100n);
    expect(out.a).toBe(34n);
    const two = rescalePayers({ a: 300n, b: 100n }, 1000n);
    expect(two).toEqual({ a: 750n, b: 250n });
  });
});

describe('group recurring: the full edit', () => {
  const rule: GroupRecurringRule = {
    id: 'rule-1',
    groupId: 'g',
    createdBy: 'a',
    description: 'Rent',
    category: null,
    currency: 'INR',
    amount: 90_000n,
    splitParams: { kind: 'equal' },
    participants: ['a', 'b', 'c'],
    payers: { a: 90_000n },
    notes: null,
    ...monthly('2026-11-01'),
    nextDate: '2026-11-01',
    endDate: null,
    status: 'active',
    lastGeneratedOn: null,
  };

  it('an untouched form is no patch', () => {
    expect(recurringFullPatch(rule, editFromRule(rule))).toBeNull();
  });

  it('a new amount sends the whole expense, payers and shares adding up', () => {
    const edit = editFromRule(rule);
    const patch = recurringFullPatch(rule, {
      ...edit,
      template: { ...edit.template, amount: 120_000n, payers: { a: 120_000n } },
    })!;
    expect(patch.amount).toBe('120000');
    expect(patch.payers).toEqual([{ memberId: 'a', amount: '120000' }]);
    expect(patch.shares!.reduce((t, l) => t + BigInt(l.amount), 0n)).toBe(120_000n);
    expect(patch.cadence).toBeUndefined();
  });

  it('changes the split, the payer, the people, the category and the notes', () => {
    const edit = editFromRule(rule);
    const patch = recurringFullPatch(rule, {
      ...edit,
      template: {
        ...edit.template,
        category: 'home',
        notes: ' flat 4B ',
        participants: ['a', 'b'],
        payers: { b: 90_000n },
        splitParams: { kind: 'percent', basisPoints: { a: 7000, b: 3000 } },
      },
    })!;
    expect(patch).toMatchObject({ category: 'home', notes: 'flat 4B', split_type: 'percent' });
    expect(patch.payers).toEqual([{ memberId: 'b', amount: '90000' }]);
    expect(patch.shares).toEqual([
      { memberId: 'a', amount: '63000' },
      { memberId: 'b', amount: '27000' },
    ]);
  });

  it('sends only the schedule fields that changed, and the end date only when it moved', () => {
    const edit = editFromRule(rule);
    const quarterly = recurringFullPatch(rule, {
      ...edit,
      when: { ...edit.when, frequency: Frequency.Quarterly, anchorDate: '2026-12-01' },
    })!;
    expect(quarterly).toEqual({
      cadence: 'monthly',
      interval: 3,
      second_day: null,
      anchor_date: '2026-12-01',
    });
    expect(
      recurringFullPatch(rule, { ...edit, when: { ...edit.when, endDate: '2027-06-01' } }),
    ).toEqual({
      end_date: '2027-06-01',
    });
    const ending = { ...rule, endDate: '2027-06-01' };
    expect(
      recurringFullPatch(ending, {
        ...editFromRule(ending),
        when: { ...editFromRule(ending).when, endDate: null },
      }),
    ).toEqual({
      end_date: null,
    });
  });

  it('twice a month and every-N-months carry their extra number', () => {
    const edit = editFromRule(rule);
    expect(
      recurringFullPatch(rule, {
        ...edit,
        when: { ...edit.when, frequency: Frequency.TwiceAMonth, secondDay: 20 },
      }),
    ).toMatchObject({ cadence: 'semimonthly', second_day: 20 });
    expect(
      recurringFullPatch(rule, {
        ...edit,
        when: { ...edit.when, frequency: Frequency.EveryNMonths, interval: 5 },
      }),
    ).toMatchObject({ cadence: 'monthly', interval: 5 });
  });

  it.each([
    [
      'name',
      (e: ReturnType<typeof editFromRule>) => ({
        ...e,
        template: { ...e.template, description: ' ' },
      }),
    ],
    [
      'amount',
      (e: ReturnType<typeof editFromRule>) => ({ ...e, template: { ...e.template, amount: 0n } }),
    ],
    [
      'people',
      (e: ReturnType<typeof editFromRule>) => ({
        ...e,
        template: { ...e.template, participants: [] },
      }),
    ],
    [
      'payers',
      (e: ReturnType<typeof editFromRule>) => ({
        ...e,
        template: { ...e.template, payers: { a: 5n } },
      }),
    ],
    [
      'split',
      (e: ReturnType<typeof editFromRule>) => ({
        ...e,
        template: { ...e.template, splitParams: { kind: 'exact', amounts: { a: 1n } } as never },
      }),
    ],
    [
      'startDate',
      (e: ReturnType<typeof editFromRule>) => ({
        ...e,
        when: { ...e.when, anchorDate: '2026-02-30' },
      }),
    ],
    [
      'endDate',
      (e: ReturnType<typeof editFromRule>) => ({
        ...e,
        when: { ...e.when, endDate: '2026-10-01' },
      }),
    ],
  ])('refuses an invalid edit (%s) with a named problem and no patch', (problem, make) => {
    const bad = make(editFromRule(rule));
    expect(recurringEditProblem(bad)).toBe(problem);
    expect(recurringFullPatch(rule, bad)).toBeNull();
  });

  it('shows stopped and past-end rules as ended', () => {
    expect(recurringDisplayStatus(rule)).toBe('active');
    expect(recurringDisplayStatus({ ...rule, status: 'paused' })).toBe('paused');
    expect(recurringDisplayStatus({ ...rule, status: 'stopped' })).toBe('ended');
    expect(recurringDisplayStatus({ ...rule, endDate: '2026-10-31' })).toBe('ended');
  });
});
