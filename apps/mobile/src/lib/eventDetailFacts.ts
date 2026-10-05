/**
 * The event-organizer facts the expense details screen shows (docs/event-organizer.md):
 * the sub-event tag and the vendor advance. Pure, so the "only when set" and
 * "overdue" rules are testable without React.
 */

export interface EventDetailVersion {
  readonly sub_event_id?: string | null;
  readonly is_deposit?: boolean;
  readonly balance_due_minor?: string | null;
  readonly balance_due_date?: string | null;
}

export interface EventDetailFacts {
  /** The tagged sub-event, when it is one the group's template still knows. An
   *  id the template lacks (renamed/removed) is still shown, without an emoji. */
  readonly subEvent: { readonly id: string; readonly emoji: string } | null;
  readonly isDeposit: boolean;
  /** Still owed to the vendor; null when none is recorded or it is zero. */
  readonly balanceDueMinor: bigint | null;
  readonly balanceDueDate: string | null;
  /** The balance's date is strictly before today in the group's time zone. */
  readonly overdue: boolean;
}

/** Today's ISO day in `timeZone`. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function eventDetailFacts({
  version,
  subEvents,
  timeZone,
  now,
}: {
  version: EventDetailVersion;
  subEvents: readonly { readonly id: string; readonly emoji: string }[];
  timeZone: string;
  now?: Date;
}): EventDetailFacts {
  const subEventId = version.sub_event_id ?? null;
  const known = subEventId ? subEvents.find((subEvent) => subEvent.id === subEventId) : undefined;
  const isDeposit = version.is_deposit === true;
  const raw = isDeposit ? version.balance_due_minor : null;
  const balance = raw == null ? null : BigInt(raw);
  const balanceDueMinor = balance !== null && balance > 0n ? balance : null;
  const balanceDueDate = isDeposit ? (version.balance_due_date ?? null) : null;
  return {
    subEvent: subEventId ? { id: subEventId, emoji: known?.emoji ?? '' } : null,
    isDeposit,
    balanceDueMinor,
    balanceDueDate,
    overdue:
      balanceDueMinor !== null &&
      balanceDueDate !== null &&
      balanceDueDate < todayInZone(timeZone, now),
  };
}
