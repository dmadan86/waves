/**
 * Turning an activity row into a sentence.
 *
 * This lives outside both feed screens because there are two of them — the
 * cross-group tab and the tab on a group — and a feed that words the same
 * event two different ways is a feed people stop trusting. It was already
 * wrong once: the group tab rendered `verb` and `object_type` raw, so an
 * offline-sync conflict read "Ravi superseded expense_version", which names
 * a table rather than telling the person their edit was replaced.
 *
 * The actor is the point of the whole thing. On a shared ledger "Dinner was
 * edited" answers nothing — "Ravi edited Dinner" does. Written from the
 * reader's point of view, so their own actions read as "You".
 */

import type Ionicons from '@expo/vector-icons/Ionicons';

import { format as formatMoney, isCurrencyCode } from '@waves/core';

import { formatShortDateRange } from '@/lib/tripDateRange';

import { actorName, type ActivityRow } from './types';

/**
 * An activity `payload` is an untyped JSON blob, so a bad amount must render as
 * no amount, not as a crashed feed. Shared by both feed screens so they parse
 * it the same way. `fallbackCurrency` is the caller's default — 'INR' on the
 * cross-group tab, the group's own currency on a group.
 */
export function parseMoney(
  payload: unknown,
  fallbackCurrency = 'INR',
): { amount: bigint; currency: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.amount !== 'string') return null;
  const trimmed = record.amount.trim();
  if (trimmed === '') return null;
  try {
    const currency =
      typeof record.currency === 'string' && isCurrencyCode(record.currency)
        ? record.currency
        : fallbackCurrency;
    return { amount: BigInt(trimmed), currency };
  } catch {
    return null;
  }
}

/**
 * `myStake` moved to @waves/core when the web grew a ledger that had to
 * answer the same question. Re-exported here so every screen that already asks
 * this file for it keeps asking this file for it.
 */
export { myStake, type StakeSides } from '@waves/core';

/**
 * The wording of the two import events, which carry a count and so need a
 * plural per language. The rest of this file is English (see `activityHeadline`);
 * these come from the locale tables (`activityScreen.imported*`) because they
 * shipped after the localisation work started and have no excuse.
 *
 * Optional everywhere: a caller that passes none gets English, which is what
 * every other line here says.
 */
export interface ActivityLabels {
  /** "Imported 12 expenses". */
  importedHeadline(count: number): string;
  /** "Ravi imported 12 expenses". */
  importedSentence(who: string, count: number): string;
  importUndoneHeadline: string;
  /** "Ravi undid an import". */
  importUndoneSentence(who: string): string;
  /** The group-settings and people lines (`group_updated`, `member_*`, `claimed`, `merged`). */
  group: GroupChangeLabels;
}

/**
 * The wording of a group's settings and people changing, in one language.
 *
 * Each is the row's headline, verb first ("Renamed the group to Goa trip"),
 * and `sentence` puts the actor in front of it for the spoken label and the
 * watch ("Ravi renamed the group to Goa trip"). A change to a setting is one
 * event in the feed whichever door it came through — the settings screen, a
 * rate sheet, the archive switch — so the wording lives here with the rest.
 */
export interface GroupChangeLabels {
  renamed(name: string): string;
  nameCleared: string;
  description: string;
  /** Takes the group's `type` key ('trip'); the language supplies the name. */
  type(key: string): string;
  /** Two `YYYY-MM-DD` days, formatted for the language. */
  datesSet(start: string, end: string): string;
  datesCleared: string;
  tag(tag: string): string;
  tagCleared: string;
  currency(code: string): string;
  convertOn(code: string): string;
  convertOff: string;
  cover: string;
  currencyAdded(code: string): string;
  currencyRemoved(code: string): string;
  rateChanged(code: string): string;
  archived: string;
  unarchived: string;
  simplifyOn: string;
  simplifyOff: string;
  /** Minor units as the server sends them (a decimal string) and the code. */
  budget(amountMinor: string, currency: string): string;
  budgetCleared: string;
  stops: string;
  /** A field this build has not met. */
  changed: string;
  memberAdded(name: string): string;
  memberRemoved(name: string): string;
  memberLeft: string;
  madeAdmin(name: string): string;
  madeMember(name: string): string;
  claimed: string;
  merged(name: string): string;
  /** "{who} renamed the group to Goa trip" from the headline. */
  sentence(who: string, event: string): string;
}

/**
 * The same lines as plain strings with `{name}`-style holes, which is how the
 * locale tables carry them. `sentence` takes `{who}` and `{event}` — the
 * headline after the actor ("{who} {event}", "{who} ने {event}", "{who}: {event}").
 */
export interface GroupChangeStrings {
  renamed: string;
  nameCleared: string;
  description: string;
  type: string;
  datesSet: string;
  datesCleared: string;
  tag: string;
  tagCleared: string;
  currency: string;
  convertOn: string;
  convertOff: string;
  cover: string;
  currencyAdded: string;
  currencyRemoved: string;
  rateChanged: string;
  archived: string;
  unarchived: string;
  simplifyOn: string;
  simplifyOff: string;
  budget: string;
  budgetCleared: string;
  stops: string;
  changed: string;
  memberAdded: string;
  memberRemoved: string;
  memberLeft: string;
  madeAdmin: string;
  madeMember: string;
  claimed: string;
  merged: string;
  sentence: string;
}

/** The kind-of-group names, by the `groups.type` key, in one language. */
export type GroupTypeNames = Readonly<Record<string, string>>;

export const ENGLISH_GROUP_STRINGS: GroupChangeStrings = {
  renamed: 'Renamed the group to {name}',
  nameCleared: 'Cleared the group name',
  description: 'Changed the description',
  type: 'Changed the group type to {type}',
  datesSet: 'Set the dates to {range}',
  datesCleared: 'Cleared the dates',
  tag: 'Changed the tag to {tag}',
  tagCleared: 'Cleared the tag',
  currency: 'Changed the currency to {code}',
  convertOn: 'Turned on Convert to {code}',
  convertOff: 'Turned off Convert',
  cover: 'Changed the cover',
  currencyAdded: 'Added {code}',
  currencyRemoved: 'Removed {code}',
  rateChanged: 'Changed the {code} rate',
  archived: 'Archived the group',
  unarchived: 'Unarchived the group',
  simplifyOn: 'Turned on Fewer repayments',
  simplifyOff: 'Turned off Fewer repayments',
  budget: 'Set the budget to {amount}',
  budgetCleared: 'Cleared the budget',
  stops: 'Changed the trip stops',
  changed: 'Changed the group settings',
  memberAdded: 'Added {name}',
  memberRemoved: 'Removed {name}',
  memberLeft: 'Left the group',
  madeAdmin: 'Made {name} an admin',
  madeMember: 'Made {name} a member',
  claimed: 'Claimed their place',
  merged: 'Merged {name} into one person',
  sentence: '{who} {event}',
};

const ENGLISH_TYPE_NAMES: GroupTypeNames = {
  trip: 'Trip',
  home: 'Home',
  couple: 'Couple',
  event: 'Event',
  friends: 'Friends',
  other: 'Other',
};

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) out = out.replaceAll(`{${key}}`, value);
  return out;
}

/**
 * Builds the group lines for a language from its strings. Pure — no locale
 * table, no native module — so `activityLabels` (which has those) and the
 * English default here share one definition.
 */
export function groupChangeLabels(
  locale: string,
  strings: GroupChangeStrings,
  typeNames: GroupTypeNames = ENGLISH_TYPE_NAMES,
): GroupChangeLabels {
  const lowersEvent = /^en(?:[-_]|$)/i.test(locale);
  const money = (amountMinor: string, currency: string): string => {
    try {
      if (!isCurrencyCode(currency)) return `${amountMinor} ${currency}`;
      return formatMoney({ minor: BigInt(amountMinor), currency }, { locale });
    } catch {
      return `${amountMinor} ${currency}`;
    }
  };
  return {
    renamed: (name) => fill(strings.renamed, { name }),
    nameCleared: strings.nameCleared,
    description: strings.description,
    type: (key) => fill(strings.type, { type: typeNames[key] ?? key }),
    datesSet: (start, end) =>
      fill(strings.datesSet, {
        range: formatShortDateRange(start, end, locale) ?? `${start} – ${end}`,
      }),
    datesCleared: strings.datesCleared,
    tag: (tag) => fill(strings.tag, { tag }),
    tagCleared: strings.tagCleared,
    currency: (code) => fill(strings.currency, { code }),
    convertOn: (code) => fill(strings.convertOn, { code }),
    convertOff: strings.convertOff,
    cover: strings.cover,
    currencyAdded: (code) => fill(strings.currencyAdded, { code }),
    currencyRemoved: (code) => fill(strings.currencyRemoved, { code }),
    rateChanged: (code) => fill(strings.rateChanged, { code }),
    archived: strings.archived,
    unarchived: strings.unarchived,
    simplifyOn: strings.simplifyOn,
    simplifyOff: strings.simplifyOff,
    budget: (amountMinor, currency) =>
      fill(strings.budget, { amount: money(amountMinor, currency) }),
    budgetCleared: strings.budgetCleared,
    stops: strings.stops,
    changed: strings.changed,
    memberAdded: (name) => fill(strings.memberAdded, { name }),
    memberRemoved: (name) => fill(strings.memberRemoved, { name }),
    memberLeft: strings.memberLeft,
    madeAdmin: (name) => fill(strings.madeAdmin, { name }),
    madeMember: (name) => fill(strings.madeMember, { name }),
    claimed: strings.claimed,
    merged: (name) => fill(strings.merged, { name }),
    // The headline leads with a capitalised verb ("Renamed the group …") that
    // has to drop its capital once a name is in front of it. Only English
    // here has a case to drop: Tamil, Hindi and Arabic have none, and their
    // headlines may begin with a Latin name or a currency code ("USD
    // சேர்க்கப்பட்டது") that must be left exactly as it is.
    sentence: (who, event) =>
      fill(strings.sentence, { who, event: lowersEvent ? lowerFirst(event) : event }),
  };
}

const ENGLISH_LABELS: ActivityLabels = {
  importedHeadline: (count) => `Imported ${count} ${count === 1 ? 'expense' : 'expenses'}`,
  importedSentence: (who, count) =>
    `${who} imported ${count} ${count === 1 ? 'expense' : 'expenses'}`,
  importUndoneHeadline: 'Import undone',
  importUndoneSentence: (who) => `${who} undid an import`,
  group: groupChangeLabels('en-IN', ENGLISH_GROUP_STRINGS),
};

/** The verbs the two triggers of 20261024100000 write, plus the two older
 *  member verbs that never had wording. All worded from `labels.group`. */
const GROUP_CHANGE_VERBS: ReadonlySet<string> = new Set([
  'group_updated',
  'member_added',
  'member_removed',
  'member_left',
  'member_role_changed',
  'claimed',
  'merged',
]);

/** Whether a row is a group-settings or people change (see `GROUP_CHANGE_VERBS`). */
export function isGroupChange(verb: string): boolean {
  return GROUP_CHANGE_VERBS.has(verb);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The `payload.field` of a `group_updated` row, or null. */
export function groupChangeField(payload: Record<string, unknown>): string | null {
  return str(payload.field);
}

/**
 * The headline of a settings or people change, from the row's payload. The
 * payloads are the trigger's `{ field, from, to, … }` for a group and
 * `{ name, from, to }` for a member; anything missing reads as the plainest
 * line rather than a hole.
 */
function groupChangeHeadline(entry: ActivityRow, g: GroupChangeLabels): string {
  const { payload } = entry;
  const name = str(payload.name) ?? 'someone';
  switch (entry.verb) {
    case 'member_added':
      return g.memberAdded(name);
    case 'member_removed':
      return g.memberRemoved(name);
    case 'member_left':
      return g.memberLeft;
    case 'member_role_changed':
      return payload.to === 'admin' ? g.madeAdmin(name) : g.madeMember(name);
    case 'claimed':
      return g.claimed;
    case 'merged':
      return g.merged(str(payload.from_name) ?? 'a placeholder');
    default:
      break;
  }
  const to = payload.to;
  switch (groupChangeField(payload)) {
    case 'name':
      return str(to) ? g.renamed(str(to)!) : g.nameCleared;
    case 'description':
      return g.description;
    case 'type':
      return g.type(str(to) ?? 'other');
    case 'dates': {
      const range = typeof to === 'object' && to !== null ? (to as Record<string, unknown>) : {};
      const start = str(range.start);
      const end = str(range.end);
      if (!start && !end) return g.datesCleared;
      return g.datesSet(start ?? end!, end ?? start!);
    }
    case 'tag':
      return str(to) ? g.tag(str(to)!) : g.tagCleared;
    case 'currency':
      return g.currency(str(to) ?? '');
    case 'convert':
      return to === true ? g.convertOn(str(payload.currency) ?? '') : g.convertOff;
    case 'cover':
      return g.cover;
    case 'fx': {
      const code = str(payload.currency) ?? '';
      if (payload.change === 'added') return g.currencyAdded(code);
      if (payload.change === 'removed') return g.currencyRemoved(code);
      return g.rateChanged(code);
    }
    case 'archived':
      return to === true ? g.archived : g.unarchived;
    case 'simplify':
      return to === true ? g.simplifyOn : g.simplifyOff;
    case 'budget': {
      const budget = typeof to === 'object' && to !== null ? (to as Record<string, unknown>) : null;
      const amount = budget ? str(budget.amount) : null;
      const currency = budget ? str(budget.currency) : null;
      return amount && currency ? g.budget(amount, currency) : g.budgetCleared;
    }
    case 'stops':
      return g.stops;
    default:
      return g.changed;
  }
}

/**
 * How many expenses an `imported` row for an import batch brought in, or null
 * when it did not say (or brought none: a file of settlements only). The older
 * `imported` row of a brand-new group has `object_type = 'group'` and no use for
 * this.
 */
function importedCount(entry: ActivityRow): number | null {
  if (entry.object_type !== 'import_batch') return null;
  const value = entry.payload.expenses;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function describeActivity(
  entry: ActivityRow,
  myProfileId: string | null,
  blocked?: ReadonlySet<string> | null,
  someoneLabel = 'Someone',
  labels: ActivityLabels = ENGLISH_LABELS,
): string {
  const { payload } = entry;
  const description = typeof payload.description === 'string' ? payload.description : null;
  const who = actorName(entry.actor, myProfileId, blocked, someoneLabel);

  switch (entry.verb) {
    case 'added':
      return `${who} added ${description ?? 'an expense'}`;
    case 'edited':
      return `${who} edited ${description ?? 'an expense'}`;
    case 'deleted':
      return `${who} deleted ${description ?? 'an expense'}`;
    case 'restored':
      return `${who} restored ${description ?? 'an expense'}`;
    case 'superseded': {
      // The conflict entry from offline sync (ADR-005). Both edits survive in
      // expense_versions; this row exists so the person whose edit lost can
      // find it and put it back. Saying "superseded expense" told them nothing.
      const replaced =
        typeof payload.supersededDescription === 'string' ? payload.supersededDescription : null;
      return replaced
        ? `${who}'s edit replaced an earlier one — "${replaced}" is still in the history`
        : `${who}'s edit replaced an earlier one`;
    }
    case 'auto_confirmed':
      // Nobody did this, so it does not get an actor. "Someone confirmed" would
      // be a lie about a settlement that resolved by itself.
      return 'A settlement was confirmed automatically after a week';
    case 'disputed': {
      const reason = typeof payload.reason === 'string' ? payload.reason : null;
      const what = description ?? 'an expense';
      return reason
        ? `${who} says ${what} is not right — "${reason}"`
        : `${who} says ${what} is not right`;
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
    case 'cancelled':
      return `${who} cancelled a recorded payment`;
    case 'settle_disputed': {
      const reason = typeof payload.reason === 'string' ? payload.reason : null;
      return reason
        ? `${who} says a payment didn't reach them — "${reason}"`
        : `${who} says a payment didn't reach them`;
    }
    case 'joined':
      return `${who} joined`;
    case 'created': {
      // The group's name at creation, carried on the payload. Nameless groups
      // (ADR: nameless_groups) leave it null, so those still read "the group".
      const name =
        typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null;
      return name ? `${who} created ${name}` : `${who} created the group`;
    }
    case 'group_deleted': {
      const name =
        typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null;
      return name ? `${who} deleted ${name}` : `${who} deleted the group`;
    }
    case 'imported': {
      const count = importedCount(entry);
      // An older `imported` row (a brand-new group, object_type 'group') falls
      // through to the generic line below, as it always has.
      if (count !== null) return labels.importedSentence(who, count);
      return `${who} ${entry.verb} ${entry.object_type}`;
    }
    case 'import_undone':
      return labels.importUndoneSentence(who);
    // Repeating group expenses: the rule's name rides the payload.
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
    // A setting or a person changing: the headline with the actor in front.
    case 'group_updated':
    case 'member_added':
    case 'member_removed':
    case 'member_left':
    case 'member_role_changed':
    case 'claimed':
    case 'merged':
      return labels.group.sentence(who, groupChangeHeadline(entry, labels.group));
    default:
      // An unknown verb is a row written by a newer build than this one. Say
      // what is known rather than dropping it — a feed with holes in it is
      // worse than a feed with one clumsy line.
      return `${who} ${entry.verb} ${entry.object_type}`;
  }
}

/**
 * The feed row's first line — the *event*, not the actor.
 *
 * `describeActivity` writes a full sentence ("Ravi added Dinner") and stays the
 * row's accessibility label, because a screen reader wants the whole thing in
 * one utterance. But a sighted reader skims, and a column of sentences all
 * starting with a name is slow to scan — the thing that varies row to row (what
 * happened) is buried mid-sentence. So the visible title leads with the event
 * and the actor drops to the metadata line beneath it: "Dinner added" over
 * "Ravi · Goa Trip · 2h ago". One event still reads one way in both feeds,
 * which is why this lives here beside the sentence and the icon.
 *
 * English to match `describeActivity`, which is itself not yet localized — this
 * is not the change that closes that gap.
 */
export function activityHeadline(
  entry: ActivityRow,
  labels: ActivityLabels = ENGLISH_LABELS,
): string {
  const { payload } = entry;
  const description = typeof payload.description === 'string' ? payload.description : null;
  // Verb first, description second. An imported description can itself be a whole
  // clause ("Hethu paid Madan D."), and suffixing the verb onto that reads as a
  // dangling "... added". Leading with the verb keeps our word anchored and reads
  // cleanly whatever the description is. Lower-case fallback since it now trails
  // a capitalised verb.
  const what = description ?? 'expense';

  switch (entry.verb) {
    case 'added':
      return `Added ${what}`;
    case 'edited':
      return `Edited ${what}`;
    case 'deleted':
      return `Deleted ${what}`;
    case 'restored':
      return `Restored ${what}`;
    case 'superseded':
      return 'Edit replaced';
    case 'disputed':
      return `Flagged ${what}`;
    case 'withdrew_dispute':
      return 'Correction withdrawn';
    case 'accepted_dispute':
      return 'Correction accepted';
    case 'rejected_dispute':
      return 'Marked correct';
    case 'settled':
      return 'Settlement recorded';
    case 'confirmed':
      return 'Settlement confirmed';
    case 'auto_confirmed':
      return 'Settlement auto-confirmed';
    case 'cancelled':
      return 'Payment cancelled';
    case 'settle_disputed':
      return 'Payment rejected';
    case 'joined':
      return 'Joined the group';
    case 'created': {
      const name =
        typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null;
      return name ? `Created ${name}` : 'Group created';
    }
    case 'imported': {
      const count = importedCount(entry);
      return count !== null ? labels.importedHeadline(count) : 'Group imported';
    }
    case 'import_undone':
      return labels.importUndoneHeadline;
    case 'auto_archived':
      return 'Group archived';
    case 'recurring_created':
      return `Repeating ${what}`;
    case 'recurring_edited':
      return `Changed repeating ${what}`;
    case 'recurring_paused':
      return `Paused repeating ${what}`;
    case 'recurring_resumed':
      return `Resumed repeating ${what}`;
    case 'recurring_stopped':
      return `Stopped repeating ${what}`;
    // Its own verb rather than the plain 'deleted' above, which is about an
    // expense and would render this as "Deleted expense". The row is written
    // into the group it is about, so almost nobody will ever see it — it exists
    // so that afterwards there is a record of who did this.
    case 'group_deleted':
      return 'Group deleted';
    case 'group_updated':
    case 'member_added':
    case 'member_removed':
    case 'member_left':
    case 'member_role_changed':
    case 'claimed':
    case 'merged':
      return groupChangeHeadline(entry, labels.group);
    default:
      // A verb from a newer build. Say what is known rather than dropping the row.
      return `${entry.verb} ${entry.object_type}`;
  }
}

/**
 * Where a feed row should open.
 *
 * Every entry defaulted to the group screen, which answers "which group" but not
 * "which thing" — tapping "Dinner edited" and landing on the group list, not on
 * Dinner, is a dead end. The server stamps each row with the object it is about
 * (`object_type` + `object_id`), so an expense event opens the expense and a
 * join opens the member. A settlement has no detail screen of its own, so it
 * (and a group-level event) opens the group, where the confirm cards live. A
 * missing id or an unknown type falls back to the group — the old behaviour,
 * never a broken link. A stale id lands on the app's existing not-found state,
 * the same as any other deep link into a since-deleted row.
 */
export function activityTarget(entry: ActivityRow): string {
  const group = `/group/${entry.group_id}`;
  if (!entry.object_id) return entry.object_type === 'member' ? `${group}/members` : group;
  // Somebody who is gone has no member screen worth landing on; the list is
  // where the reader sees who is left.
  if (entry.verb === 'member_removed' || entry.verb === 'member_left') return `${group}/members`;
  switch (entry.object_type) {
    case 'expense':
      return `${group}/expense/${entry.object_id}`;
    case 'member':
      return `${group}/member/${entry.object_id}`;
    default:
      // settlement, group, and anything a newer build adds: the group screen.
      return group;
  }
}

/**
 * The verb as one monochrome Ionicons line glyph — the node both feeds hang off.
 * It lives here for the same reason the wording does: two feeds drawing the same
 * event two different ways is a feed people stop trusting. Rendered in a
 * soft-brand circle, one accent, matching the dashboard's icon language exactly.
 * (Replaced an emoji-per-verb map, whose stickers clashed with the line icons
 * the rest of the app uses.)
 */
export function verbIcon(verb: string): React.ComponentProps<typeof Ionicons>['name'] {
  switch (verb) {
    case 'added':
      return 'receipt-outline';
    case 'edited':
    case 'superseded':
      return 'create-outline';
    case 'deleted':
      return 'trash-outline';
    case 'restored':
      return 'arrow-undo-outline';
    case 'settled':
      return 'card-outline';
    case 'confirmed':
    case 'auto_confirmed':
    case 'accepted_dispute':
    case 'withdrew_dispute':
    case 'rejected_dispute':
      return 'checkmark-circle-outline';
    case 'disputed':
    case 'settle_disputed':
      return 'flag-outline';
    case 'cancelled':
      return 'close-circle-outline';
    case 'joined':
      return 'person-add-outline';
    case 'created':
      return 'sparkles-outline';
    case 'imported':
      return 'cloud-upload-outline';
    case 'import_undone':
      return 'arrow-undo-outline';
    case 'recurring_created':
    case 'recurring_edited':
    case 'recurring_resumed':
      return 'repeat-outline';
    case 'recurring_paused':
      return 'pause-outline';
    case 'recurring_stopped':
      return 'stop-circle-outline';
    case 'group_updated':
      return 'settings-outline';
    case 'member_added':
      return 'person-add-outline';
    case 'member_removed':
      return 'person-remove-outline';
    case 'member_left':
      return 'exit-outline';
    case 'member_role_changed':
      return 'shield-checkmark-outline';
    case 'claimed':
      return 'person-circle-outline';
    case 'merged':
      return 'git-merge-outline';
    default:
      return 'ellipse-outline';
  }
}

/**
 * The glyph for a `group_updated` row, by which setting moved — a rename is a
 * line of text, the dates a calendar, a currency cash — so a column of
 * settings changes is skimmable the way bills are by category. A field this
 * build has not met keeps the verb's own cog.
 */
export function groupChangeIcon(
  field: string | null | undefined,
): React.ComponentProps<typeof Ionicons>['name'] {
  switch (field) {
    case 'name':
      return 'text-outline';
    case 'description':
      return 'document-text-outline';
    case 'type':
      return 'pricetags-outline';
    case 'dates':
      return 'calendar-outline';
    case 'tag':
      return 'pricetag-outline';
    case 'currency':
    case 'fx':
      return 'cash-outline';
    case 'convert':
      return 'swap-horizontal-outline';
    case 'cover':
      return 'image-outline';
    case 'archived':
      return 'archive-outline';
    case 'simplify':
      return 'git-compare-outline';
    case 'budget':
      return 'wallet-outline';
    case 'stops':
      return 'map-outline';
    default:
      return verbIcon('group_updated');
  }
}

/** The pastel tint keys an activity tile can wear (a subset of the app's tint family). */
export type ActivityTint = 'mint' | 'coral' | 'sky' | 'lilac';

/**
 * The soft tile colour for an activity verb, so the feed is skimmable by hue:
 * mint for money arriving and for confirmations, coral for a delete or a
 * dispute, sky for something added or someone joining, lilac (the brand-leaning
 * neutral) for edits, creation and anything a newer build introduces. Shared by
 * both feeds — the group Activity tab and the cross-group one — so an event
 * wears the same colour wherever it is shown. The caller maps the key through
 * `theme.tint[...]`, keeping this free of the UI theme.
 */
export function verbTint(verb: string): ActivityTint {
  switch (verb) {
    case 'settled':
    case 'confirmed':
    case 'auto_confirmed':
    case 'accepted_dispute':
    case 'restored':
    case 'withdrew_dispute':
      return 'mint';
    case 'deleted':
    case 'disputed':
    case 'settle_disputed':
    case 'cancelled':
    case 'rejected_dispute':
    case 'import_undone':
    case 'recurring_stopped':
    case 'member_removed':
      return 'coral';
    case 'added':
    case 'joined':
    case 'member_added':
    case 'claimed':
      return 'sky';
    case 'edited':
    case 'superseded':
    case 'created':
    default:
      return 'lilac';
  }
}

/**
 * "19m ago", "yesterday" — a localized relative time for a timeline entry.
 *
 * `Intl.RelativeTimeFormat` does the wording and the plural in every locale, and
 * `numeric: 'auto'` is what turns "1 day ago" into "yesterday". The unit is the
 * largest that leaves a count of at least one, so a three-hour-old event reads
 * in hours, not 180 minutes.
 *
 * Android's Hermes ships `Intl.DateTimeFormat`/`NumberFormat` but not always
 * `RelativeTimeFormat` — reaching for it there is a constructor on `undefined`,
 * which took the whole Activity screen down. So it is feature-detected, and when
 * it is missing the entry falls back to a short absolute date/time, which Hermes
 * always has. Degraded wording, never a crash.
 *
 * `now` is injectable so the two branches are testable without a live clock.
 */
/**
 * The heading over a day's worth of entries — "Today", "Yesterday", "Saturday",
 * then a plain date once the week is out.
 *
 * A feed of forty rows each stamped "3 days ago" is a list you have to read to
 * navigate; the same rows under day headings are a list you can skim. The
 * wording is `Intl`'s in every locale, and `RelativeTimeFormat` is
 * feature-detected for the same reason `relativeTime` detects it — Hermes does
 * not always ship it, and a missing constructor took this screen down once.
 *
 * The comparison is in calendar days in the phone's own timezone, not in
 * elapsed hours: something logged at 23:50 last night is "yesterday" at 00:10,
 * not "an hour ago" under today's heading.
 */
export function dayHeading(locale: string, iso: string, now: number = Date.now()): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  const when = new Date(parsed);
  const midnight = (date: Date): number =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(new Date(now)) - midnight(when)) / 86_400_000);

  const RTF = Intl.RelativeTimeFormat as typeof Intl.RelativeTimeFormat | undefined;
  if ((days === 0 || days === 1) && typeof RTF === 'function') {
    return capitalize(locale, new RTF(locale, { numeric: 'auto' }).format(-days, 'day'));
  }
  if (days > 1 && days < 7) {
    return capitalize(locale, new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(when));
  }
  const sameYear = when.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(when);
}

/** "yesterday" → "Yesterday", in the locale's own casing rules. */
function capitalize(locale: string, value: string): string {
  const [first] = Array.from(value);
  return first ? first.toLocaleUpperCase(locale) + value.slice(first.length) : value;
}

/** The calendar day an entry belongs to, as a grouping key in local time. */
export function dayKey(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  const when = new Date(parsed);
  return `${when.getFullYear()}-${when.getMonth() + 1}-${when.getDate()}`;
}

/**
 * Any feed cut into calendar days, newest first, order otherwise untouched —
 * the caller's own query already sorts it, so this only draws the lines
 * between days. Shared by the activity feed and the captures inbox, which
 * both read as "a list of things that happened" and both want the same day
 * headings rather than each inventing its own.
 */
export function groupByDay<T extends { created_at: string }>(
  entries: readonly T[],
  /**
   * Which day an entry belongs to, when it is not the day the row was written.
   * Review passes the day the money moved: a scan writes three months of bank
   * messages in one second, and every one of them would otherwise be "Today".
   */
  keyOf: (entry: T) => string = (entry) => dayKey(entry.created_at),
): { key: string; entries: T[] }[] {
  const sections: { key: string; entries: T[] }[] = [];
  for (const entry of entries) {
    const key = keyOf(entry);
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else sections.push({ key, entries: [entry] });
  }
  return sections;
}

/**
 * The earliest and latest calendar day present in a feed, each as a local Date
 * anchored at noon (a date-only value a picker is happy to seed from). Null for
 * an empty feed.
 *
 * This is what the Activity filter clamps its range picker to: the selectable
 * span is exactly the feed's own start and end, so a day before the first event
 * or after the last cannot be picked. The bounds come from the rows'
 * `created_at` read in the phone's own timezone — the same convention
 * `groupByDay`/`dayHeading` bucket by — so the picker and the day headings
 * agree on which day a timestamp belongs to. Noon, not midnight, so the anchor
 * can never slip to the neighbouring day when the picker re-reads it locally.
 */
export function activityDateSpan(
  entries: readonly { created_at: string }[],
): { earliest: Date; latest: Date } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    const parsed = Date.parse(entry.created_at);
    if (!Number.isFinite(parsed)) continue;
    if (parsed < min) min = parsed;
    if (parsed > max) max = parsed;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const noon = (ms: number): Date => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  };
  return { earliest: noon(min), latest: noon(max) };
}

/**
 * The rows whose calendar day falls within `[start, end]` inclusive, compared
 * in the phone's own timezone so the cut agrees with the day headings above it.
 * The bounds are taken at day granularity — a row's time of day never trims it —
 * and the two ends are ordered defensively, so a range picked end-first still
 * yields the same window. A pure cut on the already-loaded feed: no fetch, the
 * whole history is on the phone (the mirror).
 */
export function filterByDayRange<T extends { created_at: string }>(
  entries: readonly T[],
  start: Date,
  end: Date,
): T[] {
  const midnight = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const lo = Math.min(midnight(start), midnight(end));
  const hi = Math.max(midnight(start), midnight(end));
  return entries.filter((entry) => {
    const parsed = Date.parse(entry.created_at);
    if (!Number.isFinite(parsed)) return false;
    const when = new Date(parsed);
    const day = new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime();
    return day >= lo && day <= hi;
  });
}

export function relativeTime(
  locale: string,
  iso: string,
  now: number = Date.now(),
  // A pre-built formatter the caller can hand in. Constructing an
  // `Intl.RelativeTimeFormat` is dear, and a virtualized feed re-runs this per
  // row as it recycles — so a screen builds one per locale and passes it, the
  // same hoist the expense feed's date formatter uses. Omitted, it builds one.
  formatter?: Intl.RelativeTimeFormat,
): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  const seconds = Math.round((parsed - now) / 1000);
  const abs = Math.abs(seconds);

  const RTF = Intl.RelativeTimeFormat as typeof Intl.RelativeTimeFormat | undefined;
  const rtf =
    formatter ?? (typeof RTF === 'function' ? new RTF(locale, { numeric: 'auto' }) : undefined);
  if (rtf) {
    if (abs < 60) return rtf.format(Math.round(seconds), 'second');
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
    if (abs < 604800) return rtf.format(Math.round(seconds / 86400), 'day');
    if (abs < 2629800) return rtf.format(Math.round(seconds / 604800), 'week');
    if (abs < 31557600) return rtf.format(Math.round(seconds / 2629800), 'month');
    return rtf.format(Math.round(seconds / 31557600), 'year');
  }

  // Fallback: a short absolute stamp. Same-year events drop the year.
  const withinYear = abs < 31557600;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(withinYear ? {} : { year: 'numeric' }),
    hour: withinYear ? 'numeric' : undefined,
    minute: withinYear ? '2-digit' : undefined,
  }).format(new Date(Date.parse(iso)));
}

/**
 * The per-row stamp in the day-grouped activity feed.
 *
 * The feed is cut into day sections with a date heading over each ("Today",
 * "Yesterday", "Thursday", "28 August"), so the row already knows its day. A
 * relative "yesterday" or "3 days ago" on the row just says the heading again —
 * and a full "Aug 28, 8:12 PM" repeats it with the clock bolted on. So the split
 * is by age, not by what the device can format:
 *
 *  - under a day old → a relative "4 hours ago" / "20 minutes ago": the row's
 *    own freshness, which the heading does not carry;
 *  - a day or more old → the clock time alone ("8:16 PM"): the heading above
 *    already places the day, so the row never repeats it as "yesterday" or a
 *    weekday or a date.
 *
 * The relative half needs `Intl.RelativeTimeFormat` (backfilled by the Intl
 * polyfill on Hermes); without it, everything falls to the clock time, which is
 * still never the redundant date. `relativeTime`, used by screens that are not
 * day-grouped and do want the day word, is left as it is.
 *
 * `formatter`/`now` mirror `relativeTime` so a virtualized feed can hoist one
 * formatter per locale and stay testable without a live clock.
 */
const ONE_DAY_SECONDS = 86_400;

export function activityTimestamp(
  locale: string,
  iso: string,
  now: number = Date.now(),
  formatter?: Intl.RelativeTimeFormat,
): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;

  const RTF = Intl.RelativeTimeFormat as typeof Intl.RelativeTimeFormat | undefined;
  const canRelative = Boolean(formatter) || typeof RTF === 'function';
  const abs = Math.abs(Math.round((parsed - now) / 1000));
  // Under a day, and only if we can word it relatively: the freshness stamp.
  if (canRelative && abs < ONE_DAY_SECONDS) return relativeTime(locale, iso, now, formatter);

  // A day or more old, or no relative formatter: the clock time only. The day
  // sits in the section heading above, so the row must not repeat it.
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(parsed),
  );
}
