/**
 * Every id the demo fixture uses, in one place.
 *
 * Fixed strings rather than `randomUUID()` on purpose: the guard that keeps a
 * demo write off the server (`demo/guard.ts`) has to recognise these ids on
 * every render without having built the fixture first, and a write-path check
 * that had to materialise the whole demo group just to compare ids would be
 * the tail wagging the dog. A fixed id also means two renders of the same
 * screen agree on what the demo group is called, with no state to thread.
 *
 * None of these are real UUIDs the server would ever mint — they are prefixed
 * `demo-` so a stray log line or a support screenshot is recognisable on sight,
 * and so a real row can never collide with one by chance.
 */

export const DEMO_GROUP_ID = 'demo-group-goa-trip';

export const DEMO_MEMBER_ME_ID = 'demo-member-me';
export const DEMO_MEMBER_PRIYA_ID = 'demo-member-priya';
export const DEMO_MEMBER_ALEX_ID = 'demo-member-alex';
export const DEMO_MEMBER_SAM_ID = 'demo-member-sam';

/** Every demo member id except the viewer's own stand-in — the three "demo
 *  friends" the Friends screen marks separately. */
export const DEMO_FRIEND_MEMBER_IDS: readonly string[] = [
  DEMO_MEMBER_PRIYA_ID,
  DEMO_MEMBER_ALEX_ID,
  DEMO_MEMBER_SAM_ID,
];

export const DEMO_MEMBER_IDS: readonly string[] = [DEMO_MEMBER_ME_ID, ...DEMO_FRIEND_MEMBER_IDS];

export const DEMO_EXPENSE_FLIGHTS_ID = 'demo-expense-flights';
export const DEMO_EXPENSE_STAY_ID = 'demo-expense-stay';
export const DEMO_EXPENSE_DINNER_ID = 'demo-expense-dinner';
export const DEMO_EXPENSE_SCOOTER_ID = 'demo-expense-scooter';
export const DEMO_EXPENSE_CLUB_ID = 'demo-expense-club';
export const DEMO_EXPENSE_SHOPPING_ID = 'demo-expense-shopping';
export const DEMO_EXPENSE_GROCERIES_ID = 'demo-expense-groceries';

export const DEMO_EXPENSE_IDS: readonly string[] = [
  DEMO_EXPENSE_FLIGHTS_ID,
  DEMO_EXPENSE_STAY_ID,
  DEMO_EXPENSE_DINNER_ID,
  DEMO_EXPENSE_SCOOTER_ID,
  DEMO_EXPENSE_CLUB_ID,
  DEMO_EXPENSE_SHOPPING_ID,
  DEMO_EXPENSE_GROCERIES_ID,
];

export const DEMO_SETTLEMENT_ID = 'demo-settlement-alex-repay';

/** Every id the demo group owns — a group, its members, its expenses and its
 *  one settlement. Anything that touches one of these must never reach the
 *  sync queue; see `demo/guard.ts`. */
export const DEMO_IDS: ReadonlySet<string> = new Set<string>([
  DEMO_GROUP_ID,
  ...DEMO_MEMBER_IDS,
  ...DEMO_EXPENSE_IDS,
  DEMO_SETTLEMENT_ID,
]);

export function isDemoGroupId(id: string | null | undefined): boolean {
  return id === DEMO_GROUP_ID;
}

export function isDemoMemberId(id: string | null | undefined): boolean {
  return typeof id === 'string' && DEMO_MEMBER_IDS.includes(id);
}

export function isDemoId(id: unknown): boolean {
  return typeof id === 'string' && DEMO_IDS.has(id);
}
