'use client';

/**
 * The edit history of one expense, said as an audit.
 *
 * Nothing in this ledger is overwritten (ADR-004): an edit writes a new version
 * and the old one stays. The browser had the versions but showed only each
 * one's total, so editing 30,000 → 300 read as two unrelated rows and the one
 * screen whose job is recording edits recorded nothing useful. Every version
 * after the first now spells out which fields moved and what they went from and
 * to — the same audit the phone has shown since #478.
 *
 * The comparison itself is `diffExpenseVersions` in `@waves/core`, shared with
 * the phone, so "what counts as a change" has one answer. This file is the
 * other half: a translated label per field, each end of the arrow formatted for
 * the reader's locale, and the timeline they hang on.
 *
 * The image audit (A46 — who added or removed a receipt or an attachment) rides
 * the same timeline. It has to: the kept bill has no row of its own to
 * soft-delete, so `expense_image_events` is the only record that somebody
 * replaced the receipt, and a history that showed field edits but not that
 * would be quietly incomplete. A party-only line only reaches a party to the
 * bill — the RLS policy decides that, and a row that arrives is a row this
 * reader may see.
 */

import { useEffect, useState } from 'react';
import { FileImage, FilePlus2, Pencil, Receipt, Trash2 } from 'lucide-react';

import {
  diffExpenseVersions,
  payerAuditText,
  type ExpenseChange,
  type PayerRow,
} from '@waves/core';
import {
  nameOf,
  type ExpenseImageEvent,
  type ExpenseVersionSummary,
  type Member,
} from '@waves/api-client';

import { useStrings } from '@/i18n-context';
import { fill, type WebStrings } from '@/i18n';
import { money } from '@/lib/money';
import { waves } from '@/lib/waves';

/** One line of the diff as this screen draws it: a field name, then two values. */
interface Line {
  key: string;
  label: string;
  kind: 'money' | 'text';
  oldText: string;
  newText: string;
  /** Sign-derived colour, for the reader's own stake but never the bill's total. */
  balance?: boolean;
  oldAmount?: bigint;
  newAmount?: bigint;
}

/** One node on the timeline — a version edit or an image event, in one shape. */
interface Node {
  id: string;
  at: string;
  icon: typeof Pencil;
  tone: 'made' | 'edited' | 'added' | 'removed';
  title: string;
  money?: { amount: bigint; currency: string };
  lines?: Line[];
  /** The first version: a creation, so there is no diff to show. */
  created?: boolean;
  /** A party-only image event wears a badge. */
  partyOnly?: boolean;
}

/** A date with no time (the expense's own date), read in UTC like the rest of
 *  the screen — a bill dated the 1st must not read as the 31st in Delhi. */
function dateLabel(locale: string, iso: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

function splitLabel(t: WebStrings, splitType: string): string {
  const kinds = t.expense.splitKind as Record<string, string>;
  return kinds[splitType] ?? splitType;
}

/** A category as somebody reads it: the custom tag's own label if it has one,
 *  else the built-in's translation, else the raw code. */
function categoryLabel(t: WebStrings, code: string | null, label: string | null): string {
  const builtins = t.categories as Record<string, string>;
  return label ?? (code ? (builtins[code] ?? code) : t.expense.audit.none);
}

/** A pin: its name if somebody gave it one, else the coordinates it came from. */
function locationLabel(
  t: WebStrings,
  location: { lat: number; lng: number; name?: string | null } | null,
): string {
  if (!location) return t.expense.audit.none;
  const named = location.name?.trim();
  if (named) return named;
  return `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
}

/** The core's field-level comparison, said in this reader's language. */
function describe(
  t: WebStrings,
  locale: string,
  who: (id: string | null) => string,
  changes: ExpenseChange[],
): Line[] {
  const names = (ids: readonly string[]) => ids.map(who).join(', ') || t.expense.audit.none;
  // Names, or names with their figures when there is more than one — the same
  // printer for who paid and for who owes, because the question is the same.
  const withAmounts = (rows: readonly PayerRow[], currency: string) =>
    payerAuditText(rows, who, (minor) => money(minor, currency, locale), t.expense.audit.none);

  return changes.map((change): Line => {
    switch (change.kind) {
      case 'money':
        return {
          key: change.field,
          label: change.field === 'stake' ? t.expense.audit.yourShare : t.expense.audit.amount,
          kind: 'money',
          balance: change.balance,
          oldAmount: change.oldAmount,
          newAmount: change.newAmount,
          oldText: money(change.oldAmount, change.oldCurrency, locale),
          newText: money(change.newAmount, change.newCurrency, locale),
        };
      case 'text':
        return {
          key: change.field,
          label: t.expense.audit.description,
          kind: 'text',
          oldText: change.oldText || t.expense.audit.none,
          newText: change.newText || t.expense.audit.none,
        };
      case 'category':
        return {
          key: change.field,
          label: t.expense.audit.category,
          kind: 'text',
          oldText: categoryLabel(t, change.oldCategory, change.oldLabel),
          newText: categoryLabel(t, change.newCategory, change.newLabel),
        };
      case 'split':
        return {
          key: change.field,
          label: t.expense.audit.split,
          kind: 'text',
          oldText: splitLabel(t, change.oldSplit),
          newText: splitLabel(t, change.newSplit),
        };
      case 'date':
        return {
          key: change.field,
          label: t.expense.audit.date,
          kind: 'text',
          oldText: dateLabel(locale, change.oldIso),
          newText: dateLabel(locale, change.newIso),
        };
      case 'location':
        return {
          key: change.field,
          label: t.expense.audit.location,
          kind: 'text',
          oldText: locationLabel(t, change.oldLocation),
          newText: locationLabel(t, change.newLocation),
        };
      case 'payers':
        return {
          key: change.field,
          label: t.expense.audit.payers,
          kind: 'text',
          oldText: withAmounts(change.oldPayers, change.oldCurrency),
          newText: withAmounts(change.newPayers, change.newCurrency),
        };
      case 'members':
        // A changed set of people is a list of names. A reallocation between
        // the same people is only legible with the figures beside them — the
        // names on their own would read "Asha, Ravi → Asha, Ravi".
        return {
          key: change.field,
          label: t.expense.audit.participants,
          kind: 'text',
          oldText: change.membersChanged
            ? names(change.oldShares.map((row) => row.member_id))
            : withAmounts(change.oldShares, change.oldCurrency),
          newText: change.membersChanged
            ? names(change.newShares.map((row) => row.member_id))
            : withAmounts(change.newShares, change.newCurrency),
        };
    }
  });
}

/**
 * The colour the new value wears.
 *
 * Only the reader's own stake is a balance, so only it takes the sign-derived
 * colour the ledger uses for money owed and owing. The bill's total belongs to
 * nobody: painting ₹10,000 green because it is a positive number would have a
 * screen reader announce "you are owed ₹10,000" about a dinner.
 */
function toneOf(line: Line): string {
  if (!line.balance || line.newAmount === undefined) return '';
  if (line.newAmount > 0n) return ' pos';
  if (line.newAmount < 0n) return ' neg';
  return '';
}

/** One line of the image audit — "{name} added the receipt", etc. */
function imageAuditLine(t: WebStrings, event: ExpenseImageEvent, name: string): string {
  const template =
    event.kind === 'receipt'
      ? event.action === 'added'
        ? t.imageAudit.receiptAdded
        : t.imageAudit.receiptRemoved
      : event.action === 'added'
        ? t.imageAudit.attachmentAdded
        : t.imageAudit.attachmentRemoved;
  return fill(template, { name });
}

export function ExpenseHistory({
  groupId,
  expenseId,
  versions,
  members,
  myMemberId,
}: {
  groupId: string;
  expenseId: string;
  /** Newest version first, as `waves.expenseVersions` returns them. */
  versions: ExpenseVersionSummary[];
  /** The group as it stands. Names for the past come from `allMembers` below. */
  members: Member[];
  /** The reader, so an edit can say what it did to their side of the bill.
   *  Null for somebody with no membership row — the stake line is then left out
   *  rather than shown as zero. */
  myMemberId: string | null;
}) {
  const { t, locale } = useStrings();
  const [imageEvents, setImageEvents] = useState<ExpenseImageEvent[]>([]);
  // Everybody who was ever in this group. The page's own member list is the
  // group as it stands, which is the wrong roster for reading the past:
  // somebody who has left is still the author of the edit they made, and
  // resolving them against the current members turns the record of what they
  // did into "Someone".
  const [past, setPast] = useState<Member[] | null>(null);

  // Both reads fail quietly: they are additions to the history, and losing
  // either must not cost the reader the field-level audit beside it. A failed
  // roster falls back to the members the page already has.
  useEffect(() => {
    let active = true;
    waves
      .expenseImageEvents(expenseId)
      .then((rows) => {
        if (active) setImageEvents(rows);
      })
      .catch(() => undefined);
    waves
      .allMembers(groupId)
      .then((rows) => {
        if (active) setPast(rows);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [expenseId, groupId]);

  const roster = past ?? members;
  const who = (id: string | null) => {
    const member = roster.find((row) => row.id === id);
    return member ? nameOf(member) : t.join.someone;
  };

  // Ascending, so each version can look one step back for its diff.
  const ascending = [...versions].sort((a, b) => a.version_no - b.version_no);

  const versionNodes: Node[] = ascending.map((version, index) => {
    const created = index === 0;
    const previous = ascending[index - 1];
    return {
      id: `v-${version.id}`,
      at: version.created_at,
      icon: created ? Receipt : Pencil,
      tone: created ? 'made' : 'edited',
      title: fill(created ? t.expense.createdByName : t.expense.editedByName, {
        name: who(version.author_member_id),
      }),
      money: { amount: BigInt(version.amount), currency: version.currency },
      lines:
        created || !previous
          ? []
          : describe(t, locale, who, diffExpenseVersions(previous, version, myMemberId)),
      created,
    };
  });

  // An image event with no recorded time still belongs on the timeline, so it
  // borrows the oldest version's stamp — which sorts it to the tail rather than
  // the top, where an invented "now" would put it.
  const fallbackAt =
    ascending[0]?.created_at ?? imageEvents.find((row) => row.created_at)?.created_at ?? '';

  const imageNodes: Node[] = imageEvents.map((event) => ({
    id: `i-${event.id}`,
    at: event.created_at ?? fallbackAt,
    icon: event.action === 'added' ? (event.kind === 'receipt' ? FilePlus2 : FileImage) : Trash2,
    tone: event.action === 'added' ? 'added' : 'removed',
    title: imageAuditLine(t, event, who(event.actor_member_id)),
    partyOnly: event.visibility === 'parties',
  }));

  // Merge, drop anything with an unreadable timestamp, newest first.
  const nodes = [...versionNodes, ...imageNodes]
    .filter((node) => Number.isFinite(Date.parse(node.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  // One version and no image events is a bill that was entered and left alone.
  // There is no history to read, so the panel does not appear.
  if (nodes.length < 2) return null;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t.expense.history}</h2>
      </div>

      <ol className="timeline">
        {nodes.map((node) => {
          const Icon = node.icon;
          return (
            <li key={node.id} className="timeline-row">
              <span className={`timeline-dot tone-${node.tone}`} aria-hidden>
                <Icon size={16} strokeWidth={1.75} />
              </span>

              <div className="timeline-body">
                <div className="timeline-head">
                  <span className="timeline-title">{node.title}</span>
                  {node.money ? (
                    <span className="amount">
                      {money(node.money.amount, node.money.currency, locale)}
                    </span>
                  ) : node.partyOnly ? (
                    <span className="chip">{t.imageAudit.partyOnly}</span>
                  ) : null}
                </div>
                <time className="meta" dateTime={node.at}>
                  {new Date(node.at).toLocaleString(locale)}
                </time>

                {/* An edit spells out what changed. A creation has no diff; an
                    edit whose tracked fields all compare equal says so plainly
                    rather than leaving a blank where an explanation should be. */}
                {node.created ? null : node.lines && node.lines.length > 0 ? (
                  <dl className="diff">
                    {node.lines.map((line) => (
                      <div key={line.key} className="diff-line">
                        <dt>{line.label}</dt>
                        <dd>
                          {/* The superseded value stays muted and struck through
                              whatever it is — it is the "from" half of an arrow,
                              and emphasising both ends makes neither read as the
                              answer. */}
                          <s className="diff-was">{line.oldText}</s>
                          <span className="diff-arrow" aria-hidden>
                            →
                          </span>
                          <span className={`diff-now${toneOf(line)}`}>{line.newText}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : node.money ? (
                  <p className="meta">{t.expense.noChanges}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
