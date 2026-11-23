import { localNotificationsAllowed } from '@/lib/push';

import { planNudges, type PlanItem, type PlanNudgeInput } from './plan';
import { cancelPlanNudges, pendingPlanIds, schedulePlanNudges } from './schedule';
import { loadPlanHistory, loadPlanPrefs, recordPlanScheduled } from './settings';

export interface PlanRunInput extends Pick<
  PlanNudgeInput,
  'now' | 'txns' | 'recurrings' | 'budgets' | 'currency' | 'textKey'
> {
  readonly ownerId: string;
  readonly text: (item: PlanItem) => { title: string; body: string };
}

async function run(input: PlanRunInput): Promise<PlanItem[]> {
  if (!input.ownerId) return [];
  const [prefs, permitted, pending, history] = await Promise.all([
    loadPlanPrefs(input.ownerId),
    localNotificationsAllowed(),
    pendingPlanIds(),
    loadPlanHistory(input.ownerId),
  ]);
  // No permission, nothing scheduled. This never asks: the soft ask does that.
  const items = permitted ? planNudges({ ...input, prefs, history }) : [];
  const want = items.map((i) => i.id).sort();
  if (want.join('\n') === [...pending].sort().join('\n')) return items;

  await cancelPlanNudges();
  const set = await schedulePlanNudges(
    items.map((i) => ({
      id: i.id,
      fireAt: i.fireAt,
      url: i.url,
      ownerId: input.ownerId,
      ...input.text(i),
    })),
  );
  await recordPlanScheduled(input.ownerId, set);
  return items;
}

let chain: Promise<unknown> = Promise.resolve();

/** Re-plan. Serialised, so a foreground and a ledger change never interleave cancel/schedule. */
export function syncPlanNudges(input: PlanRunInput): Promise<PlanItem[]> {
  const next = chain.then(() => run(input));
  chain = next.catch(() => {});
  return next;
}
