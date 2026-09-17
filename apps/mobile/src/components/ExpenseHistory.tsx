import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Badge, directionalIcon, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import {
  diffExpenseVersions,
  format as formatMoney,
  money as coreMoney,
  payerAuditText,
  type CurrencyCode,
  type DiffLocation,
  type ExpenseChange,
  type MemberId,
} from '@waves/core';

import type { ExpenseVersionAudit } from '@/data/api';
import type { ExpenseImageEventRow } from '@/data/hooks';
import { type ActivityTint, dayHeading, groupByDay, relativeTime } from '@/data/activity';
import { coordLabel } from '@/lib/location';
import { fill, type UiStrings } from '@/i18n';

/**
 * The edit history of one expense, said as an audit: for every version after
 * the first, exactly which fields changed and what they went from and to
 * (ADR-004 — nothing is overwritten, and the group can see what changed). The
 * image audit (A46 — who added or removed a receipt or attachment) rides in the
 * same timeline underneath.
 *
 * The bug this fixes: the old history was a flat list of versions showing only
 * each version's amount, so editing 30,000 → 300 left no trace of *what*
 * happened. Now each edit spells out `Amount  30,000 → 300`.
 *
 * The comparison itself is `diffExpenseVersions` in `@waves/core`. It used to
 * live here, and moved when the browser grew the same screen: two copies of
 * "what counts as a change" is two answers to one question, and the drift would
 * show up as one client recording an edit the other did not. What stays here is
 * presentation — a translated label per field, each value formatted for this
 * locale, and the timeline they hang on.
 */

function splitLabel(t: UiStrings, splitType: string): string {
  const map: Record<string, string> = {
    equal: t.expense.splitEqually,
    exact: t.expense.exactAmounts,
    percent: t.expense.byPercentage,
    shares: t.expense.byShares,
    adjustment: t.expense.withAdjustments,
    itemized: t.expense.itemized,
  };
  return map[splitType] ?? splitType;
}

/** A category as somebody reads it: the custom tag's own label if it has one,
 *  else the built-in's translation, else the raw code. */
function categoryLabel(t: UiStrings, code: string | null, label: string | null): string {
  const builtins = t.categories as Record<string, string>;
  return label ?? (code ? (builtins[code] ?? code) : t.expense.audit.none);
}

function locationLabel(t: UiStrings, location: DiffLocation | null): string {
  if (!location) return t.expense.audit.none;
  return location.name?.trim() || coordLabel(location);
}

/** A date with no time (the expense's own date), read in UTC to match the rest
 *  of the screen. */
function dateLabel(locale: string, iso: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** One line of the diff as this screen draws it: a field name, then two values.
 *  Money renders through MoneyText; everything else is text. */
type Change =
  | {
      key: string;
      label: string;
      kind: 'money';
      oldAmount: bigint;
      newAmount: bigint;
      oldCurrency: string;
      newCurrency: string;
      /**
       * Whether these two figures are somebody's balance or the bill's total.
       *
       * A total belongs to nobody, so it is neutral ink — painting ₹10,000 green
       * because it is a positive number would have the screen reader announce
       * "you are owed ₹10,000" about a dinner. The viewer's own stake IS a
       * balance, so it wears the sign-derived colour the Activity feed gives it.
       */
      balance?: boolean;
    }
  | { key: string; label: string; kind: 'text'; oldText: string; newText: string };

/**
 * The core's field-level comparison, said in this reader's language.
 *
 * `diffExpenseVersions` decides *what* moved — it is shared with the browser,
 * which shows the same audit, so the rules for what counts as a change cannot
 * drift between the two. Everything below is presentation: a translated label
 * per field, and each end of the arrow formatted for this locale.
 */
function describeChanges(
  t: UiStrings,
  locale: string,
  nameOf: (id: string | null) => string,
  changes: ExpenseChange[],
): Change[] {
  const names = (ids: readonly string[]) =>
    ids.map((id) => nameOf(id)).join(', ') || t.expense.audit.none;

  return changes.map((change): Change => {
    switch (change.kind) {
      case 'money':
        return {
          key: change.field,
          label: change.field === 'stake' ? t.expense.audit.yourShare : t.expense.audit.amount,
          kind: 'money',
          oldAmount: change.oldAmount,
          newAmount: change.newAmount,
          oldCurrency: change.oldCurrency,
          newCurrency: change.newCurrency,
          balance: change.balance,
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
      case 'payers': {
        const spend = (currency: string) => (minor: bigint) =>
          formatMoney(coreMoney(minor, currency as CurrencyCode), { locale });
        return {
          key: change.field,
          label: t.expense.audit.payers,
          kind: 'text',
          oldText: payerAuditText(
            change.oldPayers,
            nameOf,
            spend(change.oldCurrency),
            t.expense.audit.none,
          ),
          newText: payerAuditText(
            change.newPayers,
            nameOf,
            spend(change.newCurrency),
            t.expense.audit.none,
          ),
        };
      }
      case 'members':
        return {
          key: change.field,
          label: t.expense.audit.participants,
          kind: 'text',
          oldText: names(change.oldMemberIds),
          newText: names(change.newMemberIds),
        };
    }
  });
}

/** One "old → new" line: a field name, then the two values with a direction
 *  arrow between them. Money renders through MoneyText; everything else is
 *  plain text with the previous value struck through. */
function ChangeLine({ change, locale }: { change: Change; locale: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text variant="micro" tone="muted">
        {change.label}
      </Text>
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
        {change.kind === 'money' ? (
          <MoneyText
            amount={change.oldAmount}
            currency={change.oldCurrency as never}
            locale={locale}
            variant="caption"
            // The superseded value stays muted whatever it is — it is the "from"
            // half of an arrow, and colouring both ends makes neither read as
            // the answer.
            tone="muted"
          />
        ) : (
          <Text
            variant="caption"
            tone="muted"
            style={{ textDecorationLine: 'line-through' }}
            numberOfLines={2}
          >
            {change.oldText}
          </Text>
        )}
        <Ionicons
          name={directionalIcon('arrow-forward')}
          size={iconSize.sm}
          color={theme.color.textFaint}
        />
        {change.kind === 'money' ? (
          <MoneyText
            amount={change.newAmount}
            currency={change.newCurrency as never}
            locale={locale}
            variant="caption"
            // Sign-derived colour and spoken label for a balance; neutral ink for
            // a total (see `balance` on Change).
            mode={change.balance ? 'balance' : 'plain'}
          />
        ) : (
          <Text variant="caption" numberOfLines={2} style={{ flexShrink: 1 }}>
            {change.newText}
          </Text>
        )}
      </Row>
    </View>
  );
}

/** One line of the image audit — "{name} added the receipt", etc. */
function imageAuditLine(t: UiStrings, event: ExpenseImageEventRow, name: string): string {
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

/** One node on the expense's timeline — a version edit or an image event, in the
 *  same shape so both render as one activity-style feed. */
interface HistoryEvent {
  id: string;
  created_at: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: ActivityTint;
  title: string;
  /** Version amount, when the node is a version. */
  money?: { amount: bigint; currency: string };
  /** The field-level diff of an edit; empty for the "created" node. */
  changes?: Change[];
  /** True for the very first version (a creation, no diff to show). */
  created?: boolean;
  /** A party-only image event wears a badge. */
  partyOnly?: boolean;
}

export function ExpenseHistory({
  versions,
  imageEvents,
  nameOf,
  myMemberId,
  t,
  locale,
}: {
  /** Newest version first, as `fetchExpenseVersions` returns them. */
  versions: ExpenseVersionAudit[];
  imageEvents: ExpenseImageEventRow[];
  nameOf: (id: string | null) => string;
  /** The reader, so an edit can say what it did to their side of the bill.
   *  Null for someone with no membership row — the stake line is then omitted
   *  rather than shown as zero. */
  myMemberId: MemberId | null;
  t: UiStrings;
  locale: string;
}) {
  const theme = useTheme();

  // Ascending, so each version can look one step back for its diff.
  const ascending = [...versions].sort((a, b) => a.version_no - b.version_no);
  // A fallback timestamp for the rare image event with no recorded time, so it
  // still buckets into a day rather than an invalid heading. Fall back to the
  // oldest version stamp (so an undated event sorts to the tail, not the top),
  // and to an image event's own stamp when there is no version at all — without
  // that second step an all-image, version-less history would drop every undated
  // event outright.
  const fallbackIso =
    ascending[0]?.created_at ?? imageEvents.find((event) => event.createdAt)?.createdAt ?? '';

  const versionEvents: HistoryEvent[] = ascending.map((version, index) => {
    const created = index === 0;
    return {
      id: `v-${version.id}`,
      created_at: version.created_at,
      icon: created ? 'receipt-outline' : 'create-outline',
      tint: created ? 'mint' : 'sky',
      title: fill(created ? t.expense.createdByName : t.expense.editedByName, {
        name: nameOf(version.author_member_id),
      }),
      money: { amount: BigInt(version.amount), currency: version.currency },
      changes: created
        ? []
        : describeChanges(
            t,
            locale,
            nameOf,
            diffExpenseVersions(ascending[index - 1]!, version, myMemberId),
          ),
      created,
    };
  });

  // The image audit (A46): who added or removed a receipt or attachment. A
  // `parties` line only reaches a party's device (RLS on the pull). Folded into
  // the same timeline so history reads as one feed.
  const imageAuditEvents: HistoryEvent[] = imageEvents.map((event) => ({
    id: `i-${event.id}`,
    created_at: event.createdAt ?? fallbackIso,
    icon: event.action === 'added' ? 'attach-outline' : 'trash-outline',
    tint: event.action === 'added' ? 'lilac' : 'coral',
    title: imageAuditLine(t, event, nameOf(event.actorMemberId)),
    partyOnly: event.visibility === 'parties',
  }));

  // Merge, drop anything with an unreadable timestamp, and sort newest-first so
  // the day buckets come out latest-day-first (like the Activity feed).
  const events = [...versionEvents, ...imageAuditEvents]
    .filter((event) => Number.isFinite(Date.parse(event.created_at)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const sections = groupByDay(events);

  return (
    <View>
      {sections.map((section) => (
        <View key={section.key}>
          {/* Day heading — the split that makes a long history skimmable, the
              same uppercase micro label the Activity feed uses. */}
          <Text
            variant="micro"
            tone="muted"
            style={{
              textTransform: 'uppercase',
              marginTop: theme.spacing.lg,
              marginBottom: theme.spacing.sm,
            }}
          >
            {dayHeading(locale, section.entries[0]!.created_at)}
          </Text>

          {section.entries.map((event, index) => {
            const tint = theme.tint[event.tint];
            return (
              <View key={event.id}>
                <Row
                  style={{
                    gap: theme.spacing.md,
                    alignItems: 'flex-start',
                    paddingVertical: theme.spacing.md,
                  }}
                >
                  {/* The soft rounded-square icon tile — the same row shape the
                      Activity and group feeds use, so history reads one way. */}
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: theme.radius.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: tint.bg,
                    }}
                  >
                    <Ionicons name={event.icon} size={iconSize.lg} color={tint.ink} />
                  </View>

                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Row style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
                      <Text variant="body" numberOfLines={2} style={{ flex: 1 }}>
                        {event.title}
                      </Text>
                      {event.money ? (
                        <MoneyText
                          amount={event.money.amount}
                          currency={event.money.currency as never}
                          locale={locale}
                          variant="caption"
                        />
                      ) : event.partyOnly ? (
                        <Badge label={t.imageAudit.partyOnly} tone="neutral" />
                      ) : null}
                    </Row>
                    <Text variant="micro" tone="muted" numberOfLines={1}>
                      {relativeTime(locale, event.created_at)}
                    </Text>

                    {/* An edit spells out what changed, aligned under its
                        sentence. A "created" node has no diff; an edit with no
                        detected field change says so plainly. */}
                    {event.created ? null : event.changes && event.changes.length > 0 ? (
                      <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.xs }}>
                        {event.changes.map((change) => (
                          <ChangeLine key={change.key} change={change} locale={locale} />
                        ))}
                      </View>
                    ) : event.money ? (
                      <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                        {t.expense.noChanges}
                      </Text>
                    ) : null}
                  </View>
                </Row>

                {index < section.entries.length - 1 ? (
                  <View style={{ height: 1, backgroundColor: theme.color.border }} />
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
