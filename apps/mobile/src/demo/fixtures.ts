/**
 * The demo group: a fixture, not a seed.
 *
 * A brand-new account has no groups, no friends, no expenses — and a blank
 * dashboard is a bad first impression of an app whose whole point is a ledger
 * with numbers in it. Rather than writing fake rows into the account's real
 * data (which would mean a migration, a sync conflict and a cleanup job the
 * moment the account turns out to want them gone), this module *computes* a
 * demo group on the fly, in the exact row shapes `@/data/hooks` already reads
 * everywhere else. The hooks splice it in next to the real rows; nothing here
 * ever touches SQLite, the mutation queue or the network. See `demo/guard.ts`
 * for the half of this that keeps it that way.
 *
 * Every id is fixed (`demo/ids.ts`), but the "me" member's `profile_id` is
 * filled in with whoever is actually signed in, so `isViewer()` — the one
 * true test of "is this mine" used by every balance in the app — recognises
 * the viewer inside their own demo trip exactly as it would in a real one.
 */

import {
  GroupType,
  SettlementMethod,
  SettlementStatus,
  type ExpenseRow,
  type ExpenseVersionRow,
  type GroupRow,
  type MemberRow,
  type SettlementRow,
} from '@/data/types';

import {
  DEMO_EXPENSE_CLUB_ID,
  DEMO_EXPENSE_DINNER_ID,
  DEMO_EXPENSE_FLIGHTS_ID,
  DEMO_EXPENSE_GROCERIES_ID,
  DEMO_EXPENSE_SCOOTER_ID,
  DEMO_EXPENSE_SHOPPING_ID,
  DEMO_EXPENSE_STAY_ID,
  DEMO_GROUP_ID,
  DEMO_MEMBER_ALEX_ID,
  DEMO_MEMBER_ME_ID,
  DEMO_MEMBER_PRIYA_ID,
  DEMO_MEMBER_SAM_ID,
  DEMO_SETTLEMENT_ID,
} from './ids';

/** Days ago → `YYYY-MM-DD`, local calendar — the shape `expense_date` wants. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Days ago, as a full timestamp — the shape `created_at` wants. A few minutes
 *  past midnight so two rows made the same day still order distinctly. */
function timestampDaysAgo(days: number, minuteOffset: number): string {
  return new Date(Date.now() - days * 86_400_000 + minuteOffset * 60_000).toISOString();
}

/**
 * The group everything below sits in — a short trip, not a running flatshare,
 * because a trip is the shape most people recognise fastest and its "when"
 * fields (dates, a cover emoji) earn their place for free.
 *
 * `created_at` is a fortnight back, well outside the dashboard's 48-hour "New"
 * window, so the demo card never wears a tag that belongs to a group someone
 * actually just made.
 */
export function demoGroupRow(): GroupRow {
  return {
    id: DEMO_GROUP_ID,
    name: null,
    description: null,
    type: GroupType.Trip,
    country_code: 'IN',
    default_currency: 'INR',
    simplify_debts: true,
    cover_emoji: '🏖️',
    photo_path: null,
    join_token: null,
    start_date: daysAgo(10),
    end_date: daysAgo(4),
    time_zone: 'Asia/Kolkata',
    remind_daily: false,
    remind_morning_at: '09:00:00',
    remind_evening_at: '20:00:00',
    archived_at: null,
    deleted_at: null,
    created_at: timestampDaysAgo(14, 0),
    budget_minor: null,
    budget_currency: null,
    pending: false,
    isDemo: true,
  };
}

/** Always "Goa trip" in English, the one place in the fixture that needs a
 *  literal name — the group's row is unnamed on purpose (see `groupLabel`),
 *  so screens wanting a printable title ask here instead of `group.name`. */
export const DEMO_GROUP_NAME = 'Goa trip';

/**
 * The four members: the viewer, and three demo friends.
 *
 * The viewer's row carries the signed-in `profile_id`, which is what makes
 * every balance below resolve from *their* side rather than a stranger's
 * (`isViewer`, `data/types.ts`). The three friends are plain ghosts, the same
 * shape an ordinary "add a person" produces — nothing here is a special case
 * the rest of the app has to know about.
 */
export function demoMembers(viewerProfileId: string): MemberRow[] {
  return [
    {
      id: DEMO_MEMBER_ME_ID,
      group_id: DEMO_GROUP_ID,
      profile_id: viewerProfileId,
      ghost_name: null,
      role: 'admin',
      vpa: null,
      payment_rail: null,
      payment_handle: null,
      left_at: null,
      invite_email: null,
      invite_phone: null,
      pending: false,
    },
    {
      id: DEMO_MEMBER_PRIYA_ID,
      group_id: DEMO_GROUP_ID,
      profile_id: null,
      ghost_name: 'Priya',
      role: 'member',
      vpa: null,
      payment_rail: null,
      payment_handle: null,
      left_at: null,
      invite_email: null,
      invite_phone: null,
      pending: false,
    },
    {
      id: DEMO_MEMBER_ALEX_ID,
      group_id: DEMO_GROUP_ID,
      profile_id: null,
      ghost_name: 'Alex',
      role: 'member',
      vpa: null,
      payment_rail: null,
      payment_handle: null,
      left_at: null,
      invite_email: null,
      invite_phone: null,
      pending: false,
    },
    {
      id: DEMO_MEMBER_SAM_ID,
      group_id: DEMO_GROUP_ID,
      profile_id: null,
      ghost_name: 'Sam',
      role: 'member',
      vpa: null,
      payment_rail: null,
      payment_handle: null,
      left_at: null,
      invite_email: null,
      invite_phone: null,
      pending: false,
    },
  ];
}

function version(input: {
  id: string;
  description: string;
  category: string;
  expenseDate: string;
  currency: string;
  amount: bigint;
  splitType: ExpenseVersionRow['split_type'];
  splitParams: ExpenseVersionRow['split_params'];
  authorMemberId: string;
  notes?: string | null;
  paymentMethod?: string | null;
  payers: readonly { memberId: string; amount: bigint }[];
  shares: readonly { memberId: string; amount: bigint }[];
  createdAt: string;
  fx?: ExpenseVersionRow['fx'];
}): ExpenseVersionRow {
  return {
    id: `${input.id}-v1`,
    version_no: 1,
    description: input.description,
    category: input.category,
    category_meta: null,
    expense_date: input.expenseDate,
    currency: input.currency,
    amount: input.amount.toString(),
    split_type: input.splitType,
    split_params: input.splitParams,
    author_member_id: input.authorMemberId,
    notes: input.notes ?? null,
    payment_method: input.paymentMethod ?? null,
    receipt_share_url: null,
    receipt_id: null,
    location: null,
    fx: input.fx ?? null,
    created_at: input.createdAt,
    payers: input.payers.map((p) => ({ member_id: p.memberId, amount: p.amount.toString() })),
    shares: input.shares.map((s) => ({ member_id: s.memberId, amount: s.amount.toString() })),
  };
}

/**
 * Seven expenses, each exercising a different shape the app supports, so the
 * demo trip reads like a real one rather than a feature checklist with
 * nothing to show.
 *
 * Every expense's payers and shares sum to its own `amount`, in minor units,
 * exactly as `@waves/core`'s split maths requires of a real one — nothing
 * here is special-cased by `computeNetBalances` or `computePairwiseBalances`,
 * which is the point: the fixture is data, the arithmetic is the app's own.
 */
export function demoExpenses(): ExpenseRow[] {
  const rows: { id: string; createdDaysAgo: number; version: ExpenseVersionRow }[] = [
    {
      id: DEMO_EXPENSE_FLIGHTS_ID,
      createdDaysAgo: 11,
      version: version({
        id: DEMO_EXPENSE_FLIGHTS_ID,
        description: 'Flights to Goa',
        category: 'travel',
        expenseDate: daysAgo(11),
        currency: 'INR',
        amount: 1_200_000n,
        splitType: 'exact',
        splitParams: {
          kind: 'exact',
          amounts: {
            [DEMO_MEMBER_ME_ID]: 500_000n,
            [DEMO_MEMBER_PRIYA_ID]: 350_000n,
            [DEMO_MEMBER_ALEX_ID]: 200_000n,
            [DEMO_MEMBER_SAM_ID]: 150_000n,
          },
        },
        authorMemberId: DEMO_MEMBER_ME_ID,
        paymentMethod: 'card',
        payers: [{ memberId: DEMO_MEMBER_ME_ID, amount: 1_200_000n }],
        shares: [
          { memberId: DEMO_MEMBER_ME_ID, amount: 500_000n },
          { memberId: DEMO_MEMBER_PRIYA_ID, amount: 350_000n },
          { memberId: DEMO_MEMBER_ALEX_ID, amount: 200_000n },
          { memberId: DEMO_MEMBER_SAM_ID, amount: 150_000n },
        ],
        createdAt: timestampDaysAgo(11, 0),
      }),
    },
    {
      id: DEMO_EXPENSE_STAY_ID,
      createdDaysAgo: 10,
      version: version({
        id: DEMO_EXPENSE_STAY_ID,
        description: 'Beach resort, 4 nights',
        category: 'stay',
        expenseDate: daysAgo(10),
        currency: 'INR',
        amount: 800_000n,
        splitType: 'equal',
        splitParams: { kind: 'equal' },
        authorMemberId: DEMO_MEMBER_PRIYA_ID,
        paymentMethod: 'card',
        payers: [{ memberId: DEMO_MEMBER_PRIYA_ID, amount: 800_000n }],
        shares: [
          { memberId: DEMO_MEMBER_ME_ID, amount: 200_000n },
          { memberId: DEMO_MEMBER_PRIYA_ID, amount: 200_000n },
          { memberId: DEMO_MEMBER_ALEX_ID, amount: 200_000n },
          { memberId: DEMO_MEMBER_SAM_ID, amount: 200_000n },
        ],
        createdAt: timestampDaysAgo(10, 0),
      }),
    },
    {
      id: DEMO_EXPENSE_DINNER_ID,
      createdDaysAgo: 9,
      version: version({
        id: DEMO_EXPENSE_DINNER_ID,
        description: 'Dinner at Thalassa',
        category: 'food',
        expenseDate: daysAgo(9),
        currency: 'INR',
        amount: 400_000n,
        splitType: 'percent',
        splitParams: {
          kind: 'percent',
          basisPoints: {
            [DEMO_MEMBER_ME_ID]: 4000,
            [DEMO_MEMBER_PRIYA_ID]: 2000,
            [DEMO_MEMBER_ALEX_ID]: 2000,
            [DEMO_MEMBER_SAM_ID]: 2000,
          },
        },
        authorMemberId: DEMO_MEMBER_ALEX_ID,
        notes: 'Grilled fish & cocktails 🍹',
        paymentMethod: 'card',
        payers: [{ memberId: DEMO_MEMBER_ALEX_ID, amount: 400_000n }],
        shares: [
          { memberId: DEMO_MEMBER_ME_ID, amount: 160_000n },
          { memberId: DEMO_MEMBER_PRIYA_ID, amount: 80_000n },
          { memberId: DEMO_MEMBER_ALEX_ID, amount: 80_000n },
          { memberId: DEMO_MEMBER_SAM_ID, amount: 80_000n },
        ],
        createdAt: timestampDaysAgo(9, 0),
      }),
    },
    {
      id: DEMO_EXPENSE_SCOOTER_ID,
      createdDaysAgo: 8,
      version: version({
        id: DEMO_EXPENSE_SCOOTER_ID,
        description: 'Scooter rental',
        category: 'travel',
        expenseDate: daysAgo(8),
        currency: 'INR',
        amount: 300_000n,
        splitType: 'shares',
        splitParams: {
          kind: 'shares',
          weights: {
            [DEMO_MEMBER_ME_ID]: 1,
            [DEMO_MEMBER_PRIYA_ID]: 1,
            [DEMO_MEMBER_ALEX_ID]: 2,
            [DEMO_MEMBER_SAM_ID]: 1,
          },
        },
        authorMemberId: DEMO_MEMBER_SAM_ID,
        paymentMethod: 'cash',
        payers: [{ memberId: DEMO_MEMBER_SAM_ID, amount: 300_000n }],
        shares: [
          { memberId: DEMO_MEMBER_ME_ID, amount: 60_000n },
          { memberId: DEMO_MEMBER_PRIYA_ID, amount: 60_000n },
          { memberId: DEMO_MEMBER_ALEX_ID, amount: 120_000n },
          { memberId: DEMO_MEMBER_SAM_ID, amount: 60_000n },
        ],
        createdAt: timestampDaysAgo(8, 0),
      }),
    },
    {
      id: DEMO_EXPENSE_CLUB_ID,
      createdDaysAgo: 7,
      version: version({
        id: DEMO_EXPENSE_CLUB_ID,
        description: 'Club entry & cover charge',
        category: 'entertainment',
        expenseDate: daysAgo(7),
        currency: 'INR',
        amount: 200_000n,
        splitType: 'equal',
        splitParams: { kind: 'equal' },
        authorMemberId: DEMO_MEMBER_ME_ID,
        paymentMethod: 'cash',
        // Two payers split the door charge between them — the app's
        // multiple-payer case, not just a multi-way split.
        payers: [
          { memberId: DEMO_MEMBER_ME_ID, amount: 100_000n },
          { memberId: DEMO_MEMBER_PRIYA_ID, amount: 100_000n },
        ],
        shares: [
          { memberId: DEMO_MEMBER_ME_ID, amount: 50_000n },
          { memberId: DEMO_MEMBER_PRIYA_ID, amount: 50_000n },
          { memberId: DEMO_MEMBER_ALEX_ID, amount: 50_000n },
          { memberId: DEMO_MEMBER_SAM_ID, amount: 50_000n },
        ],
        createdAt: timestampDaysAgo(7, 0),
      }),
    },
    {
      id: DEMO_EXPENSE_SHOPPING_ID,
      createdDaysAgo: 6,
      version: version({
        id: DEMO_EXPENSE_SHOPPING_ID,
        description: 'Duty-free shopping',
        category: 'shopping',
        expenseDate: daysAgo(6),
        // A foreign-currency expense in an INR group (ADR-003): nothing here
        // converts it, it simply carries the rate it was written with.
        currency: 'USD',
        amount: 4_000n,
        splitType: 'equal',
        splitParams: { kind: 'equal' },
        authorMemberId: DEMO_MEMBER_ME_ID,
        paymentMethod: 'card',
        payers: [{ memberId: DEMO_MEMBER_ME_ID, amount: 4_000n }],
        // Only two of the four actually bought anything duty-free.
        shares: [
          { memberId: DEMO_MEMBER_ME_ID, amount: 2_000n },
          { memberId: DEMO_MEMBER_PRIYA_ID, amount: 2_000n },
        ],
        createdAt: timestampDaysAgo(6, 0),
        fx: {
          num: '83',
          den: '1',
          from: 'USD',
          to: 'INR',
          ts: timestampDaysAgo(6, 0),
          source: 'demo',
        },
      }),
    },
    {
      id: DEMO_EXPENSE_GROCERIES_ID,
      createdDaysAgo: 5,
      version: version({
        id: DEMO_EXPENSE_GROCERIES_ID,
        description: 'Groceries for the villa',
        category: 'groceries',
        expenseDate: daysAgo(5),
        currency: 'INR',
        amount: 120_000n,
        splitType: 'equal',
        splitParams: { kind: 'equal' },
        authorMemberId: DEMO_MEMBER_ME_ID,
        paymentMethod: 'upi',
        payers: [{ memberId: DEMO_MEMBER_ME_ID, amount: 120_000n }],
        shares: [
          { memberId: DEMO_MEMBER_ME_ID, amount: 30_000n },
          { memberId: DEMO_MEMBER_PRIYA_ID, amount: 30_000n },
          { memberId: DEMO_MEMBER_ALEX_ID, amount: 30_000n },
          { memberId: DEMO_MEMBER_SAM_ID, amount: 30_000n },
        ],
        createdAt: timestampDaysAgo(5, 0),
      }),
    },
  ];

  return rows.map((row) => ({
    id: row.id,
    group_id: DEMO_GROUP_ID,
    deleted_at: null,
    created_at: timestampDaysAgo(row.createdDaysAgo, 0),
    currentVersion: row.version,
    pending: false,
  }));
}

/** One settlement: Alex pays back part of what they owe, confirmed — so the
 *  demo group shows a payment, not only bills. */
export function demoSettlements(): SettlementRow[] {
  return [
    {
      id: DEMO_SETTLEMENT_ID,
      group_id: DEMO_GROUP_ID,
      from_member_id: DEMO_MEMBER_ALEX_ID,
      to_member_id: DEMO_MEMBER_ME_ID,
      currency: 'INR',
      amount: '150000',
      method: SettlementMethod.Upi,
      status: SettlementStatus.Confirmed,
      note: 'Partial settle up',
      initiated_at: timestampDaysAgo(3, 0),
      confirmed_at: timestampDaysAgo(3, 5),
      allocations: [],
      pending: false,
    },
  ];
}
