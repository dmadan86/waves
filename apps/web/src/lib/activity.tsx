/**
 * An activity row, worded from the reader's point of view.
 *
 * Mirrors `apps/mobile/src/data/activity.ts` deliberately: a feed that words
 * the same event two different ways across the phone and the browser is a feed
 * people stop trusting. English only for now, as the mobile copy is — the
 * verbs are the same on both.
 */

import { createElement } from 'react';
import {
  Banknote,
  CircleCheck,
  Dot,
  Flag,
  Handshake,
  LogOut,
  Merge,
  Pencil,
  Receipt,
  Repeat,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  UserCheck,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

import { actorName, type ActivityRow } from '@waves/api-client';

export function describeActivity(entry: ActivityRow, myProfileId: string | null): string {
  const { payload } = entry;
  const description = typeof payload?.description === 'string' ? payload.description : null;
  const who = actorName(entry.actor, myProfileId);

  switch (entry.verb) {
    case 'added':
      return `${who} added ${description ?? 'an expense'}`;
    case 'edited':
      return `${who} edited ${description ?? 'an expense'}`;
    case 'deleted':
      return `${who} deleted ${description ?? 'an expense'}`;
    case 'restored':
      return `${who} restored ${description ?? 'an expense'}`;
    case 'superseded':
      return `${who}'s edit replaced an earlier one`;
    case 'auto_confirmed':
      return 'A settlement was confirmed automatically after a week';
    case 'disputed': {
      const what = description ?? 'an expense';
      return `${who} says ${what} is not right`;
    }
    case 'withdrew_dispute':
      return `${who} took back their correction to ${description ?? 'an expense'}`;
    case 'accepted_dispute':
      return `${who} agreed ${description ?? 'an expense'} needs fixing`;
    case 'rejected_dispute':
      return `${who} says ${description ?? 'an expense'} is correct as it stands`;
    case 'settled':
      return `${who} recorded a settlement`;
    case 'confirmed':
      return `${who} confirmed a settlement`;
    case 'joined':
      return `${who} joined`;
    case 'created': {
      // The group's name at creation, carried on the payload. Nameless groups
      // leave it null, so those still read "the group".
      const name =
        typeof payload?.name === 'string' && payload.name.trim() ? payload.name.trim() : null;
      return name ? `${who} created ${name}` : `${who} created the group`;
    }
    case 'recurring_created':
      return `${who} set ${description ?? 'an expense'} to repeat`;
    case 'recurring_edited':
      return `${who} changed the repeating ${description ?? 'expense'}`;
    case 'recurring_paused':
      return `${who} paused the repeating ${description ?? 'expense'}`;
    case 'recurring_resumed':
      return `${who} resumed the repeating ${description ?? 'expense'}`;
    case 'recurring_stopped':
      return `${who} stopped the repeating ${description ?? 'expense'}`;
    // The group itself changing (the triggers of 20261024100000): its settings
    // and its people. Same lines as the phone, worded from the actor.
    case 'group_updated':
      return `${who} ${groupChange(payload)}`;
    case 'member_added':
      return `${who} added ${name(payload)}`;
    case 'member_removed':
      return `${who} removed ${name(payload)}`;
    case 'member_left':
      return `${who} left the group`;
    case 'member_role_changed':
      return payload?.to === 'admin'
        ? `${who} made ${name(payload)} an admin`
        : `${who} made ${name(payload)} a member`;
    case 'claimed':
      return `${who} claimed their place`;
    case 'merged': {
      const from = typeof payload?.from_name === 'string' ? payload.from_name : 'a placeholder';
      return `${who} merged ${from} into one person`;
    }
    default:
      return `${who} ${entry.verb} ${entry.object_type}`;
  }
}

function name(payload: ActivityRow['payload']): string {
  return typeof payload?.name === 'string' && payload.name.trim() ? payload.name.trim() : 'someone';
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The lower-case clause after the actor for a `group_updated` row. */
function groupChange(payload: ActivityRow['payload']): string {
  const to = payload?.to;
  const toRecord = typeof to === 'object' && to !== null ? (to as Record<string, unknown>) : null;
  switch (text(payload?.field)) {
    case 'name':
      return text(to) ? `renamed the group to ${text(to)}` : 'cleared the group name';
    case 'description':
      return 'changed the description';
    case 'type':
      return `changed the group type to ${text(to) ?? 'other'}`;
    case 'dates': {
      const start = text(toRecord?.start);
      const end = text(toRecord?.end);
      if (!start && !end) return 'cleared the dates';
      return `set the dates to ${start ?? end} – ${end ?? start}`;
    }
    case 'tag':
      return text(to) ? `changed the tag to ${text(to)}` : 'cleared the tag';
    case 'currency':
      return `changed the currency to ${text(to) ?? ''}`;
    case 'convert':
      return to === true
        ? `turned on Convert to ${text(payload?.currency) ?? ''}`
        : 'turned off Convert';
    case 'cover':
      return 'changed the cover';
    case 'fx': {
      const code = text(payload?.currency) ?? '';
      if (payload?.change === 'added') return `added ${code}`;
      if (payload?.change === 'removed') return `removed ${code}`;
      return `changed the ${code} rate`;
    }
    case 'archived':
      return to === true ? 'archived the group' : 'unarchived the group';
    case 'simplify':
      return to === true ? 'turned on Fewer repayments' : 'turned off Fewer repayments';
    case 'budget':
      return toRecord
        ? `set the budget to ${text(toRecord.amount) ?? ''} ${text(toRecord.currency) ?? ''}`.trim()
        : 'cleared the budget';
    case 'stops':
      return 'changed the trip stops';
    default:
      return 'changed the group settings';
  }
}

/**
 * The glyph beside an activity line.
 *
 * Was an emoji per verb, which rendered differently on every operating system
 * and could not take the row's colour. A stroked icon inherits `currentColor`
 * and sits on the baseline, and the mapping is the same one the words above
 * use — added is a receipt, disputed is a flag, settled is money moving.
 */
export function VerbIcon({ verb }: { verb: string }) {
  // `createElement` rather than binding the icon to a capitalised local and
  // writing it as a tag: picking a component during render is how a component
  // gets re-created every render, and React's lint rule cannot tell this
  // lookup is a fixed table. The element is what varies here, not the type.
  return createElement(iconForVerb(verb), { size: 18, strokeWidth: 1.75, 'aria-hidden': true });
}

function iconForVerb(verb: string): LucideIcon {
  switch (verb) {
    case 'added':
      return Receipt;
    case 'edited':
    case 'superseded':
      return Pencil;
    case 'deleted':
      return Trash2;
    case 'restored':
      return Undo2;
    case 'settled':
      return Banknote;
    case 'confirmed':
    case 'auto_confirmed':
    case 'accepted_dispute':
      return CircleCheck;
    case 'disputed':
      return Flag;
    case 'withdrew_dispute':
    case 'rejected_dispute':
      return Handshake;
    case 'joined':
      return UserPlus;
    case 'created':
      return Sparkles;
    case 'recurring_created':
    case 'recurring_edited':
    case 'recurring_paused':
    case 'recurring_resumed':
    case 'recurring_stopped':
      return Repeat;
    case 'group_updated':
      return Settings;
    case 'member_added':
      return UserPlus;
    case 'member_removed':
      return UserMinus;
    case 'member_left':
      return LogOut;
    case 'member_role_changed':
      return ShieldCheck;
    case 'claimed':
      return UserCheck;
    case 'merged':
      return Merge;
    default:
      return Dot;
  }
}
