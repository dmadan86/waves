/**
 * What a "People who owe you" row says and offers, decided in one place so every
 * kind of member reads the same way: avatar, name, one status line, the amount,
 * and one Remind pill (a bell for someone on Waves, the channel's icon for
 * someone who is not).
 */

import { GhostChannel } from '@/lib/ghostReminder';

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

export enum OwedRemind {
  Push = 'push',
  WhatsApp = 'whatsapp',
  Email = 'email',
  Share = 'share',
}

export interface OwedRowInput {
  /** A Waves account, as opposed to someone added by name. */
  readonly joined: boolean;
  /** The member row exists (a ghost with no row cannot be reminded). */
  readonly hasMember: boolean;
  readonly left: boolean;
  readonly pending: boolean;
  /** The in-app nudge came back with a message (sent, or already sent today). */
  readonly nudged: boolean;
  /** The off-app reminder was just handed to WhatsApp, mail or the share sheet. */
  readonly reminded: boolean;
  readonly channel: GhostChannel;
}

export interface OwedRowModel {
  readonly status: OwedStatus;
  /** Which Remind pill the row carries; null when none (already reminded). */
  readonly remind: OwedRemind | null;
  /** The (i) that says why this person gets no app reminder. */
  readonly info: boolean;
}

function ghostRemind(channel: GhostChannel): OwedRemind {
  if (channel === GhostChannel.WhatsApp) return OwedRemind.WhatsApp;
  if (channel === GhostChannel.Email) return OwedRemind.Email;
  return OwedRemind.Share;
}

export function owedRowModel(input: OwedRowInput): OwedRowModel {
  const { joined, hasMember, left, pending, nudged, reminded, channel } = input;
  const feedback = joined ? nudged : reminded;
  const status = feedback
    ? OwedStatus.Feedback
    : pending && joined
      ? OwedStatus.Pending
      : left
        ? OwedStatus.Left
        : !joined
          ? OwedStatus.NotOnWaves
          : OwedStatus.Tap;
  if (joined) {
    return { status, remind: nudged ? null : OwedRemind.Push, info: false };
  }
  if (!hasMember || reminded) return { status, remind: null, info: false };
  return { status, remind: ghostRemind(channel), info: true };
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
