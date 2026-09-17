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
  Pencil,
  Receipt,
  Sparkles,
  Trash2,
  Undo2,
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
    default:
      return `${who} ${entry.verb} ${entry.object_type}`;
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
    default:
      return Dot;
  }
}
