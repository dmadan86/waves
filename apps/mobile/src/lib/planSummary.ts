/**
 * The Plan card's Planned / Spent / Left-or-Over reading (docs/event-organizer.md).
 *
 * "No budget" is not a budget of zero: with nothing planned there is nothing to
 * be over, so the card shows Spent alone and says "No budget set" rather than a
 * full red bar. Over only exists once a budget above zero exists and spend
 * passes it. Pure, so it is tested directly (test/planSummary.test.ts).
 */

export type PlanState = 'none' | 'left' | 'over';

export interface PlanSummary {
  readonly state: PlanState;
  readonly plannedMinor: bigint;
  readonly spentMinor: bigint;
  /** Always >= 0: what is left (state 'left') or by how much it is over. */
  readonly gapMinor: bigint;
  /** Share of the plan used, 0..100 (capped); 0 when there is no budget. */
  readonly percentUsed: number;
}

export function planSummary(plannedMinor: bigint, spentMinor: bigint): PlanSummary {
  if (plannedMinor <= 0n) {
    return { state: 'none', plannedMinor: 0n, spentMinor, gapMinor: 0n, percentUsed: 0 };
  }
  const over = spentMinor > plannedMinor;
  const raw = Number((spentMinor * 100n) / plannedMinor);
  return {
    state: over ? 'over' : 'left',
    plannedMinor,
    spentMinor,
    gapMinor: over ? spentMinor - plannedMinor : plannedMinor - spentMinor,
    percentUsed: Math.max(0, Math.min(100, raw)),
  };
}
