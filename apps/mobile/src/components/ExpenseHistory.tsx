import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Badge, directionalIcon, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import {
  diffExpenseVersions,
  format as formatMoney,
  money as coreMoney,
  payerAuditText,
  type CurrencyCode,
  type DepositFacts,
  type DiffLocation,
  type ExpenseChange,
  type MemberId,
} from '@waves/core';

import type { ExpenseVersionAudit } from '@/data/api';
import type { ExpenseImageEventRow } from '@/data/hooks';
import { dayHeading, groupByDay, relativeTime } from '@/data/activity';
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

/** How it was paid, in the words add-expense uses (the capture strings), so a
 *  rail is named the same way on the form and in its history. */
function paymentMethodLabel(t: UiStrings, code: string | null): string {
  const labels: Record<string, string> = {
    cash: t.captures.payCash,
    upi: t.captures.payUpi,
    credit: t.captures.payCredit,
    debit: t.captures.payDebit,
    forex: t.captures.payForex,
  };
  return code ? (labels[code] ?? code) : t.expense.audit.none;
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

/** A time of day, in the reader's own timezone — it is a UTC instant, and "7:30
 *  pm" means the wall clock where they are, unlike the expense's date above. */
function timeLabel(t: UiStrings, locale: string, iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return t.expense.audit.none;
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** "6 Oct, 3:24 PM": the day and time of an audit stamp, in the reader's own
 *  timezone (it is a UTC instant). The relative phrase beside it is vague past a
 *  day, so the exact moment rides along. */
function stampLabel(locale: string, iso: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** The vendor-deposit reminder as one phrase: not a deposit, or a deposit with
 *  whatever of the balance and due date is known. */
function depositLabel(
  t: UiStrings,
  locale: string,
  deposit: DepositFacts,
  currency: string,
): string {
  const audit = t.expense.audit;
  if (!deposit.isDeposit) return audit.depositOff;
  if (deposit.balanceDueMinor === null) return audit.depositOn;
  const amount = formatMoney(coreMoney(deposit.balanceDueMinor, currency as CurrencyCode), {
    locale,
  });
  return deposit.balanceDueDate
    ? fill(audit.depositOwingOn, { amount, date: dateLabel(locale, deposit.balanceDueDate) })
    : fill(audit.depositOwing, { amount });
}

/** The icon each field wears beside its name, so a list of changes scans by
 *  glyph before it is read. */
const CHANGE_ICONS: Record<ExpenseChange['field'], React.ComponentProps<typeof Ionicons>['name']> =
  {
    stake: 'person-outline',
    amount: 'cash-outline',
    description: 'text-outline',
    category: 'pricetag-outline',
    split: 'pie-chart-outline',
    date: 'calendar-outline',
    location: 'location-outline',
    payers: 'wallet-outline',
    participants: 'people-outline',
    notes: 'document-text-outline',
    paymentMethod: 'card-outline',
    time: 'time-outline',
    receipt: 'receipt-outline',
    deposit: 'hourglass-outline',
    subEvent: 'flag-outline',
    splitDetails: 'options-outline',
  };

/** One line of the diff as this screen draws it: a field name, then two values.
 *  Money renders through MoneyText; everything else is text. */
type Change =
  | {
      key: ExpenseChange['field'];
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
  | { key: ExpenseChange['field']; label: string; kind: 'text'; oldText: string; newText: string }
  // A change with no before/after to show: the fact that it happened is the
  // whole message (split details, whose params are not human-readable).
  | { key: ExpenseChange['field']; label: string; kind: 'note' };

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
          label: change.field === 'notes' ? t.expense.audit.notes : t.expense.audit.description,
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
      case 'paymentMethod':
        return {
          key: change.field,
          label: t.expense.audit.paymentMethod,
          kind: 'text',
          oldText: paymentMethodLabel(t, change.oldMethod),
          newText: paymentMethodLabel(t, change.newMethod),
        };
      case 'time':
        return {
          key: change.field,
          label: t.expense.audit.time,
          kind: 'text',
          oldText: timeLabel(t, locale, change.oldIso),
          newText: timeLabel(t, locale, change.newIso),
        };
      case 'receipt':
        return {
          key: change.field,
          label: t.expense.audit.receipt,
          kind: 'text',
          oldText: change.oldHasReceipt ? t.expense.audit.receiptAttached : t.expense.audit.none,
          newText: change.replaced
            ? t.expense.audit.receiptReplaced
            : change.newHasReceipt
              ? t.expense.audit.receiptAttached
              : t.expense.audit.none,
        };
      case 'deposit':
        return {
          key: change.field,
          label: t.expense.audit.depositOn,
          kind: 'text',
          oldText: depositLabel(t, locale, change.oldDeposit, change.currency),
          newText: depositLabel(t, locale, change.newDeposit, change.currency),
        };
      case 'subEvent':
        return {
          key: change.field,
          label: t.expense.audit.subEvent,
          kind: 'text',
          oldText: change.oldId
            ? (t.eventSubEvents[change.oldId] ?? change.oldId)
            : t.expense.audit.none,
          newText: change.newId
            ? (t.eventSubEvents[change.newId] ?? change.newId)
            : t.expense.audit.none,
        };
      case 'splitDetails':
        return { key: change.field, label: t.expense.audit.splitDetails, kind: 'note' };
      case 'members': {
        // A changed set of people is a list of names. A reallocation between
        // the same people is only legible with the figures beside them — the
        // names on their own would read "Asha, Ravi → Asha, Ravi".
        const spend = (currency: string) => (minor: bigint) =>
          formatMoney(coreMoney(minor, currency as CurrencyCode), { locale });
        return {
          key: change.field,
          label: t.expense.audit.participants,
          kind: 'text',
          oldText: change.membersChanged
            ? names(change.oldShares.map((row) => row.member_id))
            : payerAuditText(
                change.oldShares,
                nameOf,
                spend(change.oldCurrency),
                t.expense.audit.none,
              ),
          newText: change.membersChanged
            ? names(change.newShares.map((row) => row.member_id))
            : payerAuditText(
                change.newShares,
                nameOf,
                spend(change.newCurrency),
                t.expense.audit.none,
              ),
        };
      }
    }
  });
}

/** One "old → new" line: the field's glyph, its name, then the two values with
 *  a direction arrow between them. Money renders through MoneyText; everything
 *  else is plain text with the previous value struck through. */
function ChangeLine({ change, locale }: { change: Change; locale: string }) {
  const theme = useTheme();
  const glyph = (
    <Ionicons
      name={CHANGE_ICONS[change.key]}
      size={iconSize.md}
      color={theme.color.brand}
      // Nudged to sit on the label's first line rather than the block's middle.
      style={{ marginTop: 1 }}
    />
  );
  if (change.kind === 'note') {
    return (
      <Row style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
        {glyph}
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          {change.label}
        </Text>
      </Row>
    );
  }
  return (
    <Row style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
      {glyph}
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text variant="caption" style={{ fontWeight: '600' }}>
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
              style={{ textDecorationLine: 'line-through' }}
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
              style={{ fontWeight: '700' }}
              // Sign-derived colour and spoken label for a balance; neutral ink for
              // a total (see `balance` on Change).
              mode={change.balance ? 'balance' : 'plain'}
            />
          ) : (
            <Text variant="caption" numberOfLines={2} style={{ flexShrink: 1, fontWeight: '700' }}>
              {change.newText}
            </Text>
          )}
        </Row>
      </View>
    </Row>
  );
}

/** One fact of the created entry: glyph, a fixed-width label, then the value, so
 *  the values line up in a column the way the design has them. */
function FactLine({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const theme = useTheme();
  return (
    <Row style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} style={{ marginTop: 1 }} />
      <Text variant="caption" tone="muted" style={{ width: 84 }} numberOfLines={1}>
        {label}
      </Text>
      <Text variant="caption" style={{ flex: 1, fontWeight: '700' }} numberOfLines={2}>
        {value}
      </Text>
    </Row>
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
  title: string;
  /** Version amount, when the node is a version. */
  money?: { amount: bigint; currency: string };
  /** The field-level diff of an edit; empty for the "created" node. */
  changes?: Change[];
  /** True for the very first version (a creation, no diff to show). */
  created?: boolean;
  /** What the bill was born as, for the created entry's fact panel. */
  facts?: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string }[];
  /** A party-only image event wears a badge. */
  partyOnly?: boolean;
}

export function ExpenseHistory({
  versions,
  imageEvents,
  nameOf,
  myMemberId,
  groupName,
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
  /** The group the bill sits in, for the created entry's facts. */
  groupName: string;
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
      icon: created ? 'add' : 'pencil-outline',
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
      // The first version has no diff, so it lists what the bill started as —
      // otherwise the oldest card would be an empty shell under its title.
      facts: created
        ? [
            {
              icon: 'text-outline',
              label: t.expense.audit.description,
              value: version.description.trim() || t.expense.audit.none,
            },
            {
              icon: 'pricetag-outline',
              label: t.expense.audit.category,
              value: categoryLabel(t, version.category, version.category_meta?.label ?? null),
            },
            { icon: 'people-outline', label: t.expense.detailGroup, value: groupName },
            {
              icon: 'calendar-outline',
              label: t.expense.detailDate,
              value: dateLabel(locale, version.expense_date),
            },
          ]
        : undefined,
    };
  });

  // The image audit (A46): who added or removed a receipt or attachment. A
  // `parties` line only reaches a party's device (RLS on the pull). Folded into
  // the same timeline so history reads as one feed.
  const imageAuditEvents: HistoryEvent[] = imageEvents.map((event) => ({
    id: `i-${event.id}`,
    created_at: event.createdAt ?? fallbackIso,
    icon: event.action === 'added' ? 'attach-outline' : 'trash-outline',
    title: imageAuditLine(t, event, nameOf(event.actorMemberId)),
    partyOnly: event.visibility === 'parties',
  }));

  // Merge, drop anything with an unreadable timestamp, and sort newest-first so
  // the day buckets come out latest-day-first (like the Activity feed).
  const events = [...versionEvents, ...imageAuditEvents]
    .filter((event) => Number.isFinite(Date.parse(event.created_at)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const sections = groupByDay(events);

  // The timeline gutter: a dot per card on a thin line, so the entries read as
  // one sequence. The line runs through the gap to the next card.
  const GUTTER = 16;
  const DOT = 8;
  const DOT_TOP = 18;
  const GAP = theme.spacing.sm;

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
              marginTop: theme.spacing.md,
              marginBottom: theme.spacing.sm,
            }}
          >
            {dayHeading(locale, section.entries[0]!.created_at)}
          </Text>

          {section.entries.map((event, index) => {
            const first = index === 0;
            const last = index === section.entries.length - 1;
            const hasChanges = Boolean(event.changes && event.changes.length > 0);
            return (
              <Row
                key={event.id}
                style={{
                  alignItems: 'stretch',
                  gap: theme.spacing.sm,
                  marginBottom: last ? 0 : GAP,
                }}
              >
                <View style={{ width: GUTTER, alignItems: 'center' }}>
                  <View
                    style={{
                      position: 'absolute',
                      width: 1,
                      // First card starts the line at its dot, last ends it there;
                      // the rest run through, bridging the gap to the next card.
                      top: first ? DOT_TOP + DOT / 2 : 0,
                      bottom: last ? undefined : -GAP,
                      height: last ? DOT_TOP + DOT / 2 : undefined,
                      backgroundColor: theme.color.brandSoft,
                    }}
                  />
                  <View
                    style={{
                      marginTop: DOT_TOP,
                      width: DOT,
                      height: DOT,
                      borderRadius: DOT / 2,
                      backgroundColor: theme.color.brand,
                    }}
                  />
                </View>

                <View
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: theme.spacing.md,
                    gap: theme.spacing.sm,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.color.surface,
                    ...theme.shadow.soft,
                  }}
                >
                  <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
                    {/* The brand-soft disc: the same glyph language as the hero's
                        controls, so history reads as part of this screen. */}
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      <Ionicons name={event.icon} size={iconSize.md} color={theme.color.brand} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="body" style={{ fontWeight: '700' }} numberOfLines={2}>
                        {event.title}
                      </Text>
                      <Text variant="micro" tone="muted" numberOfLines={1}>
                        {`${relativeTime(locale, event.created_at)} • ${stampLabel(locale, event.created_at)}`}
                      </Text>
                    </View>
                    {event.money ? (
                      <MoneyText
                        amount={event.money.amount}
                        currency={event.money.currency as never}
                        locale={locale}
                        variant="subheading"
                        style={{ fontWeight: '700' }}
                      />
                    ) : event.partyOnly ? (
                      <Badge label={t.imageAudit.partyOnly} tone="neutral" />
                    ) : null}
                  </Row>

                  {/* What changed, in a quiet inset panel. A "created" node lists
                      what the bill started as; an edit with no detected field
                      change says so in one line. */}
                  {event.facts || hasChanges || event.money ? (
                    <View
                      style={{
                        gap: theme.spacing.sm,
                        paddingHorizontal: theme.spacing.md,
                        paddingVertical: theme.spacing.sm,
                        borderRadius: theme.radius.sm,
                        backgroundColor: theme.color.surfaceMuted,
                      }}
                    >
                      {event.facts ? (
                        event.facts.map((fact) => <FactLine key={fact.label} {...fact} />)
                      ) : hasChanges ? (
                        event.changes!.map((change) => (
                          <ChangeLine key={change.key} change={change} locale={locale} />
                        ))
                      ) : (
                        <Text variant="caption" tone="muted">
                          {t.expense.noChanges}
                        </Text>
                      )}
                    </View>
                  ) : null}
                </View>
              </Row>
            );
          })}
        </View>
      ))}
    </View>
  );
}
