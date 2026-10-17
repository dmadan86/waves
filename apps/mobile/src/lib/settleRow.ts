/**
 * What a "People who owe you" row says and offers, decided in one place so every
 * kind of member reads the same way: avatar, name, one status line, the amount,
 * and one Remind pill, identical for everyone. The channel is picked in the
 * sheet the pill opens; `remindOptions` says which channels that sheet offers.
 */

export enum OwedStatus {
  /** A reminder was just sent: its own words ("Reminded", "Already nudged today"). */
  Feedback = 'feedback',
  Pending = 'pending',
  /** Left the group but still owes. */
  Left = 'left',
  NotOnWaves = 'not_on_waves',
  /** Nothing to add: the row says what a tap does. */
  Tap = 'tap',
}

/** The ways a reminder can go; the person picks one in the Remind sheet. */
export enum RemindChannel {
  Waves = 'waves',
  WhatsApp = 'whatsapp',
  Sms = 'sms',
  Share = 'share',
}

export enum RemindUnavailable {
  NotOnWaves = 'not_on_waves',
  /** The one in-app nudge a day to this person has gone already. */
  NudgedToday = 'nudged_today',
}

/** The server refuses a second nudge to the same person inside this window. */
export const NUDGE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether an in-app nudge to this person would be refused right now, from the
 * time of the last one. Mirrors the server's rule (`reminders` trigger:
 * a second nudge less than a day after the last) so the sheet can say so up
 * front; the server stays the judge. Unknown or unreadable means "allowed".
 */
export function nudgedWithinWindow(
  lastNudgedAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastNudgedAt) return false;
  const last = Date.parse(lastNudgedAt);
  if (Number.isNaN(last)) return false;
  return now < last + NUDGE_WINDOW_MS;
}

export interface RemindOption {
  readonly channel: RemindChannel;
  readonly enabled: boolean;
  readonly reason: RemindUnavailable | null;
  /** The channel this person used last time for this member. */
  readonly lastUsed: boolean;
}

const DEFAULT_ORDER = [
  RemindChannel.Waves,
  RemindChannel.WhatsApp,
  RemindChannel.Sms,
  RemindChannel.Share,
] as const;

export function parseRemindChannel(value: string | null | undefined): RemindChannel | null {
  return DEFAULT_ORDER.find((channel) => channel === value) ?? null;
}

/**
 * Which channels the Remind sheet lists, in order. Waves is always listed but
 * disabled (with its reason) for someone not on Waves or already nudged today; SMS needs a phone;
 * WhatsApp and Share are always there. Usable channels come first with the
 * last-used one leading; the disabled one goes last.
 */
export function remindOptions(input: {
  readonly joined: boolean;
  readonly hasPhone: boolean;
  readonly lastUsed: RemindChannel | null;
  /** The in-app nudge to them already went today. */
  readonly nudgedToday?: boolean;
}): RemindOption[] {
  const { joined, hasPhone, lastUsed, nudgedToday = false } = input;
  const options: RemindOption[] = DEFAULT_ORDER.filter(
    (channel) => channel !== RemindChannel.Sms || hasPhone,
  ).map((channel) => {
    const isWaves = channel === RemindChannel.Waves;
    const enabled = !isWaves || (joined && !nudgedToday);
    return {
      channel,
      enabled,
      reason: enabled
        ? null
        : !joined
          ? RemindUnavailable.NotOnWaves
          : RemindUnavailable.NudgedToday,
      lastUsed: enabled && channel === lastUsed,
    };
  });
  const rank = (option: RemindOption): number => (option.enabled ? (option.lastUsed ? 0 : 1) : 2);
  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => rank(a.option) - rank(b.option) || a.index - b.index)
    .map(({ option }) => option);
}

export interface OwedRowInput {
  /** A Waves account, as opposed to someone added by name. */
  readonly joined: boolean;
  /** The member row exists (a ghost with no row cannot be reminded). */
  readonly hasMember: boolean;
  readonly left: boolean;
  readonly pending: boolean;
  /** A reminder was just sent, over any channel. */
  readonly reminded: boolean;
}

export interface OwedRowModel {
  readonly status: OwedStatus;
  /** Whether the row carries the Remind pill (the same one for everybody). */
  readonly remind: boolean;
}

export function owedRowModel(input: OwedRowInput): OwedRowModel {
  const { joined, hasMember, left, pending, reminded } = input;
  const status = reminded
    ? OwedStatus.Feedback
    : pending && joined
      ? OwedStatus.Pending
      : left
        ? OwedStatus.Left
        : !joined
          ? OwedStatus.NotOnWaves
          : OwedStatus.Tap;
  return { status, remind: hasMember && !reminded };
}

/**
 * The header's "2 members · 1 left": how many members who left the group still
 * have a balance. Zero when nobody does, and the header stays as it was.
 */
export function leftWithBalance(
  members: readonly { readonly id: string; readonly left_at?: string | null }[],
  balances: ReadonlyMap<string, bigint>,
): number {
  return members.filter((member) => member.left_at && (balances.get(member.id) ?? 0n) !== 0n)
    .length;
}
