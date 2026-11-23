/**
 * When a private date is worth a nudge. Pure: `now`, the dismissed set and the
 * occurrences come in; the card to show and the one notification to schedule
 * come out. One notification at a time means at most one a day by construction.
 */

import type { UpcomingItem } from '@waves/core';

/** Days ahead a birthday/anniversary reminder appears. */
export const LEAD_DAYS = 5;
/** Days ahead a festival reminder appears. */
export const FESTIVAL_LEAD_DAYS = 21;
/** Local hour the notification lands. */
export const NOTIFY_HOUR = 10;

export const leadDays = (item: UpcomingItem): number =>
  item.source === 'festival' ? FESTIVAL_LEAD_DAYS : LEAD_DAYS;

/** My own birthday has no action to offer, so it is never reminded about. */
const remindable = (item: UpcomingItem): boolean => item.kind !== 'my_birthday';

/** The one "From Waves" card: the soonest remindable date inside its lead window. */
export function pickReminderCard(
  items: readonly UpcomingItem[],
  dismissed: ReadonlySet<string>,
): UpcomingItem | null {
  return (
    items.find((i) => remindable(i) && i.inDays <= leadDays(i) && !dismissed.has(i.key)) ?? null
  );
}

/** Local 10:00 on the reminder day (occurrence minus lead), as epoch ms. */
export function fireTimeFor(item: UpcomingItem): number {
  const [y, m, d] = item.date.split('-').map(Number);
  return new Date(y!, m! - 1, d! - leadDays(item), NOTIFY_HOUR, 0, 0, 0).getTime();
}

/** The next notification to hold: the earliest future fire time, or null. */
export function planDateNotification(
  items: readonly UpcomingItem[],
  dismissed: ReadonlySet<string>,
  now: number,
): { readonly fireAt: number; readonly item: UpcomingItem } | null {
  let best: { fireAt: number; item: UpcomingItem } | null = null;
  for (const item of items) {
    if (!remindable(item) || dismissed.has(item.key)) continue;
    const fireAt = fireTimeFor(item);
    if (fireAt <= now) continue;
    if (!best || fireAt < best.fireAt) best = { fireAt, item };
  }
  return best;
}
