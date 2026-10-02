/**
 * One bank message, as a row you can tick.
 *
 * The shape is the one every app of this kind has converged on, and it has
 * converged for a reason: a glyph for what it was, the shop, the day, the bank
 * and the last digits of the card, and the amount hard right where a column of
 * numbers can be read down in one pass. What differs here is what the row is
 * *for* — not "here is a transaction" but "is this yours to split?" — so three
 * things are added that a personal-finance list would not carry.
 *
 *   * **A tick box, always visible.** Not revealed by a long press. Choosing
 *     several and placing them together is the main verb of this screen, and a
 *     main verb behind a hidden gesture is a main verb most people never find.
 *   * **What the app was unsure of, on the row.** "Date guessed", "check this
 *     one" — the two doubts that decide whether a row went to Review by itself
 *     (`lib/smsInbox.ts`). A row marked this way is a row somebody should open
 *     before ticking, and saying which part is doubtful is the difference
 *     between a useful warning and a vague one.
 *   * **Whether Review already has it.** The confident expenses are in both
 *     places by design; a row that did not say so would look like a duplicate.
 *
 * The message body is never on the row, though the row has one. It is on the
 * detail screen, behind a tap, labelled as being on this phone only — a list
 * that printed everybody's bank messages down the side of the screen would be
 * a list nobody could open in public.
 */

import { memo } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { guessCategory, resolveCategory, SmsKind, type SmsOtherReason } from '@waves/core';
import { iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { dayHeading } from '@/data/activity';
import type { UiStrings } from '@/i18n';
import { doubtsAbout, reachedReview } from '@/lib/smsInbox';
import { bankFromSender } from '@/lib/smsPlain';
import type { StoredSms } from '@/lib/smsMessageTypes';

/** The words for why a row is in the third pile. */
export function reasonWords(reason: SmsOtherReason | null, t: UiStrings): string | null {
  switch (reason) {
    case 'card-bill':
      return t.smsInbox.reasonCardBill;
    case 'wallet-top-up':
      return t.smsInbox.reasonWalletTopUp;
    case 'investment':
      return t.smsInbox.reasonInvestment;
    case 'self-transfer':
      return t.smsInbox.reasonSelfTransfer;
    case 'cash-withdrawal':
      return t.smsInbox.reasonCashWithdrawal;
    case 'refund':
      return t.smsInbox.reasonRefund;
    default:
      return null;
  }
}

export const SmsMessageRow = memo(function SmsMessageRow({
  row,
  selected,
  locale,
  now,
  t,
  onToggle,
  onOpen,
}: {
  row: StoredSms;
  selected: boolean;
  locale: string;
  /** The screen's own clock — never `Date.now()` read while rendering. */
  now: number;
  t: UiStrings;
  onToggle: () => void;
  onOpen: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const doubts = doubtsAbout(row);
  const reason = reasonWords(row.reason, t);
  const inReview = reachedReview(row);

  // The bank, in the words a person uses for it. `lib/smsPlain` states the rule
  // this follows — *when we do not know, we say nothing* — and the row was
  // breaking it: it printed `row.sender` raw, so a column of payments read
  // "AD-AXISBK-S", which is an operator prefix, a registered header and a
  // message-category letter, two thirds of it routing. A code on the screen is
  // worse than a blank, because a blank is honestly empty and a code looks like
  // information the reader is failing to understand.
  const bank = bankFromSender(row.sender);

  // A great many bank messages name no shop — a UPI transfer, an ATM, a bill.
  // Three rows reading "No shop named" down a column tell the reader nothing
  // and look broken. The bank is the next truest thing about such a row, and it
  // is something a person recognises, so it takes the line and the placeholder
  // becomes the last resort it should always have been.
  const name = row.merchant ?? bank ?? t.smsInbox.noShopNamed;
  // Only where it is not already the title — a row that said "Axis Bank · Axis
  // Bank" would be repeating itself to fill space.
  const secondary = row.merchant && bank ? bank : null;

  // Money coming in reads as a credit; everything else reads as money leaving.
  // The sign is carried by the colour *and* the words beside it, never colour
  // alone (#191).
  const incoming = row.kind === SmsKind.Income;

  // The category is only a guess from the shop's name — nothing has chosen it
  // yet — so it is shown as a quiet chip, and only for money going out.
  const guessed = incoming || reason ? null : guessCategory(name);
  const guessedLabel = guessed ? t.categories[guessed as keyof typeof t.categories] : null;
  const isNew = row.settledAs === null && row.readAt >= new Date(now - 86_400_000).toISOString();
  const meta = [
    dayHeading(locale, row.at, now),
    secondary,
    row.accountTail,
    inReview ? t.smsInbox.inReview : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // The gap under each card is padding on an outer box, never a margin: the
  // list measures a cell without its margins and would draw the next card
  // over the space.
  return (
    <View style={{ paddingBottom: 6 }}>
      <Row
        style={{
          alignItems: 'center',
          gap: theme.spacing.sm,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.color.surface,
          borderWidth: 1,
          borderColor: selected ? theme.color.brand : theme.color.border,
        }}
      >
        {/* The tick box owns its own hit area, so ticking a row and opening it
          are two different taps a thumb can tell apart. */}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={name}
          hitSlop={10}
          onPress={onToggle}
        >
          <Ionicons
            name={selected ? 'checkbox' : 'square-outline'}
            size={iconSize.lg}
            color={selected ? theme.color.brand : theme.color.textMuted}
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={name}
          onPress={onOpen}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {/* Guessed from whatever the row is called — a coffee cup for a café. */}
          <CategoryBadge category={guessed} meta={null} description={name} size={38} />

          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
              <Text
                numberOfLines={1}
                style={{ flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.color.text }}
              >
                {name}
              </Text>
              {isNew ? <Pill label={t.smsInbox.isNew} tone="brand" /> : null}
            </Row>

            <Text variant="micro" tone="muted" numberOfLines={1}>
              {meta}
            </Text>

            {/* One chip: what is doubtful when something is, why it is not
              counted when it is in the third pile, else the guessed category. */}
            {doubts.length > 0 || reason || guessedLabel ? (
              <Row style={{ gap: theme.spacing.xs, flexWrap: 'wrap', marginTop: 3 }}>
                {doubts.includes('hard-to-read') ? (
                  <Pill label={t.smsInbox.hardToRead} tone="negative" icon="alert-circle" />
                ) : doubts.includes('date-inferred') ? (
                  <Pill label={t.smsInbox.dateGuessed} tone="negative" icon="alert-circle" />
                ) : reason ? (
                  <Pill label={reason} tone="neutral" />
                ) : guessed && guessedLabel ? (
                  <Pill
                    label={guessedLabel}
                    tone="neutral"
                    icon={resolveCategory(guessed, null).icon as keyof typeof Ionicons.glyphMap}
                  />
                ) : null}
              </Row>
            ) : null}
          </View>

          <Row style={{ alignItems: 'center', gap: 4 }}>
            <MoneyText
              amount={BigInt(safeMinor(row.amount))}
              currency={row.currency}
              locale={locale}
              variant="body"
              tone={incoming ? 'positive' : undefined}
            />
            <Ionicons name="chevron-forward" size={iconSize.sm} color={theme.color.textMuted} />
          </Row>
        </Pressable>
      </Row>
    </View>
  );
});

/** A small rounded chip: "New", "Check this one", a category. */
function Pill({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: 'brand' | 'negative' | 'neutral';
  icon?: keyof typeof Ionicons.glyphMap;
}): React.JSX.Element {
  const theme = useTheme();
  const colors =
    tone === 'brand'
      ? { bg: theme.color.brandSoft, ink: theme.color.brand }
      : tone === 'negative'
        ? { bg: theme.color.negativeSoft, ink: theme.color.negative }
        : { bg: theme.color.surfaceMuted, ink: theme.color.textMuted };
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        height: 20,
        borderRadius: 11,
        backgroundColor: colors.bg,
        alignSelf: 'flex-start',
      }}
    >
      {icon ? <Ionicons name={icon} size={12} color={colors.ink} /> : null}
      <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: '600', color: colors.ink }}>
        {label}
      </Text>
    </Row>
  );
}

/**
 * An amount the ledger can take, or zero.
 *
 * A row whose amount is not a whole number of minor units is a parser bug, and
 * it is one this screen must survive rather than crash on: `BigInt('12.5')`
 * throws, and a throw inside a recycled list row takes the whole screen down.
 * The row is still shown — placing it will report it as unusable, which is the
 * honest outcome — and zero is visibly wrong rather than quietly plausible.
 */
function safeMinor(amount: string): string {
  return /^-?\d+$/.test(amount.trim()) ? amount.trim() : '0';
}
