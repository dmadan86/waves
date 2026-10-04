/**
 * One bank message, opened.
 *
 * This screen exists for a reason that is easy to state and was not obvious:
 * **a person cannot trust a parser they cannot check.** The list says "SWIGGY
 * ₹1,250, Tuesday". That is the app's reading of a message, and when it is
 * wrong — a merchant read out of a reference number, a date taken from the
 * wrong half of a UPI string — there is no way to tell from the row. Showing
 * the message the app was reading turns "I think this is wrong" into "I can see
 * why it is wrong", and that is the difference between a feature people audit
 * once and abandon, and one they come to rely on.
 *
 * The redesign below keeps that promise and adds three small, testable checks
 * on top of it:
 *
 *   * **The highlights are found, not guessed.** `lib/smsHighlights.ts` only
 *     colours a span when the exact amount/date/merchant the parser already
 *     extracted is sitting in the body at that offset — any currency's number
 *     formatting, any of the date spellings a bank actually uses, Arabic body
 *     text included (bidi is a rendering concern, not an indexing one).
 *   * **"Seen before" is read off the device's own history.** No new field,
 *     no network call — `lib/smsMerchantHistory.ts` is a pure pass over the
 *     messages `useSmsMessages` already has loaded.
 *   * **The category you pick here is the category the expense gets.** The
 *     quick-pick row's choice rides along into `useSmsRowPlacement`, which
 *     overrides the guess the placement path would otherwise make.
 *
 * ## Which is exactly why the body has to stay here
 *
 * It is on this phone (`lib/smsMessageStore.ts`), sealed at rest with the same
 * key as the ledger mirror, in a database the sync engine cannot see. It is
 * destroyed when the account signs out. The line under it on this screen says
 * so in as many words, because a person looking at their own bank messages
 * inside a splitting app deserves to be told, at that moment, where they are.
 *
 * What leaves the phone, if this row is placed in a group, is the shop, the
 * amount and the day. Not this text. `lib/smsDrafts.ts` and
 * `lib/smsPlacement.ts` are where that is enforced.
 *
 * ## The actions
 *
 * **Create expense** — the ordinary path, through the same picker the Bank
 * messages list and the voice review use (`useSmsRowPlacement`, a single-row
 * copy of the list's own `placeInGroup`/`assignToPeople`).
 * **Set aside** — it is not an expense, or not one worth splitting. It is
 * reversible, and this screen is where it is reversed.
 * **Ignore this message** / the header's trash icon — both reach the same
 * place: delete it from Waves. The message stays in the phone's own Messages
 * app; only Waves' copy goes, which the confirmation says, because "delete"
 * next to a bank message reads far more alarming than what it actually does.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { CategoryId, format as formatMoney, guessCategory, SmsKind } from '@waves/core';
import {
  Avatar,
  Badge,
  Button,
  Card,
  directionalIcon,
  Divider,
  IconButton,
  iconSize,
  MoneyText,
  Row,
  Screen,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

import { CategoryBadge, CategorySheet } from '@/components/Category';
import { DestinationPicker, type DestinationChoice } from '@/components/DestinationPicker';
import { SignInWall } from '@/components/SignInWall';
import { reasonWords } from '@/components/SmsMessageRow';
import { dayHeading, relativeTime } from '@/data/activity';
import { fill, plural, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { useLocalSearchParams } from 'expo-router';

import { router } from '@/lib/navigation';
import { doubtsAbout, reachedReview } from '@/lib/smsInbox';
import { findHighlightSpans, type HighlightKind, type HighlightSpan } from '@/lib/smsHighlights';
import { quickCategoryPicks, transactionBadge } from '@/lib/smsMessageDetail';
import { seenBefore } from '@/lib/smsMerchantHistory';
import { reloadMessages, useSmsMessages } from '@/lib/smsMessages';
import { forgetMessage, settleMessages, unsettleMessage } from '@/lib/smsMessageStore';
import { SmsSettlement } from '@/lib/smsMessageTypes';
import { useSmsInboxReader } from '@/lib/smsFeature';
import { bankFromSender, bankFromText, merchantName } from '@/lib/smsPlain';
import { useToast } from '@/lib/toast';
import { type CategoryChoice, useSmsRowPlacement } from '@/lib/useSmsRowPlacement';

export default function SmsMessageScreen(): React.JSX.Element | null {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const clearance = useBottomClearance();
  const { session, isGuest } = useAuth();
  const ownerId = session?.user?.id ?? '';
  const viewerId = session?.user?.id ?? null;
  const reader = useSmsInboxReader();
  const toast = useToast();
  const { confirm } = useDialog();

  const params = useLocalSearchParams<{ key?: string }>();
  const dedupeKey = typeof params.key === 'string' ? params.key : '';

  const { rows } = useSmsMessages();
  const row = useMemo(
    () => rows.find((each) => each.dedupeKey === dedupeKey) ?? null,
    [rows, dedupeKey],
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Called unconditionally — same rule the callbacks below already follow —
  // so a null `row` never has to mean a conditionally-called hook.
  const placement = useSmsRowPlacement(ownerId, viewerId);
  const [category, setCategory] = useState<CategoryChoice | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);

  const setAside = useCallback(async (): Promise<void> => {
    if (!row) return;
    await settleMessages(ownerId, [row.dedupeKey], SmsSettlement.Dismissed);
    await reloadMessages(ownerId);
    router.back();
  }, [ownerId, row]);

  const bringBack = useCallback(async (): Promise<void> => {
    if (!row) return;
    await unsettleMessage(ownerId, row.dedupeKey);
    await reloadMessages(ownerId);
  }, [ownerId, row]);

  const forget = useCallback(async (): Promise<void> => {
    if (!row) return;
    const ok = await confirm({
      title: t.smsInbox.forget,
      body: t.smsInbox.forgetConfirm,
      confirmLabel: t.common.delete,
      tone: 'danger',
    });
    if (!ok) return;
    await forgetMessage(ownerId, row.dedupeKey);
    await reloadMessages(ownerId);
    toast.show(t.smsInbox.forget);
    router.back();
  }, [confirm, ownerId, row, t.common.delete, t.smsInbox.forget, t.smsInbox.forgetConfirm, toast]);

  // A guest is turned away with a reason rather than a blank screen, and
  // before the reader check, which is false for them too.
  if (isGuest) return <SignInWall area="sms" />;

  // Asked again here rather than trusted from the screen that pushed: a deep
  // link or a stale back stack must end the same way as everything else.
  if (!reader) return null;
  if (!row) {
    // The row was deleted on this device while this screen was open, or the
    // link points at a message this account does not have. Neither is an error
    // worth a dialog — there is simply nothing here.
    return (
      <Screen edges={['top']}>
        <Row style={{ padding: theme.spacing.xl, alignItems: 'center', gap: theme.spacing.sm }}>
          <IconButton label={t.common.back} onPress={() => router.back()}>
            <Ionicons
              name={directionalIcon('chevron-back')}
              size={iconSize.md}
              color={theme.color.text}
            />
          </IconButton>
          <Text variant="title">{t.smsInbox.detailTitle}</Text>
        </Row>
      </Screen>
    );
  }

  const doubts = doubtsAbout(row);
  const reason = reasonWords(row.reason, t);
  const bank = bankFromSender(row.sender) ?? bankFromText(row.body);
  const name = merchantName(row.merchant) ?? bank ?? t.smsInbox.noShopNamed;
  const amount = /^\d+$/.test(row.amount.trim()) ? BigInt(row.amount.trim()) : 0n;

  // "Today, 2 Oct 2026" — the relative word everything else in the app uses,
  // beside the plain date for whoever opens this a week from now and would
  // rather not do the arithmetic from "last Tuesday".
  const relativeLabel = dayHeading(locale, row.at, now);
  const fullDate = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(row.at));
  const dateSubtitle =
    relativeLabel.toLowerCase() === fullDate.toLowerCase()
      ? fullDate
      : `${relativeLabel}, ${fullDate}`;

  // One of three — "Added" and "Set aside" are final, "In Review" is the one
  // state a message reaches entirely on its own, before anybody has touched
  // it. A message that reached neither (still in doubt, or in the third pile)
  // carries no pill: none of the three words would be true of it yet.
  const statusPill =
    row.settledAs === SmsSettlement.Placed
      ? { label: t.smsInbox.statusAdded, tone: 'positive' as const }
      : row.settledAs === SmsSettlement.Dismissed
        ? { label: t.smsInbox.statusSetAside, tone: 'neutral' as const }
        : reachedReview(row)
          ? { label: t.smsInbox.inReview, tone: 'brand' as const }
          : null;

  // The plain debit/credit badge only where it says something the reason chip
  // above does not already say — see `lib/smsMessageDetail.ts`.
  const badge = reason === null ? transactionBadge(row) : null;
  const badgeLabel =
    badge === 'debit'
      ? t.smsInbox.badgeDebit
      : badge === 'credit'
        ? t.smsInbox.badgeCredit
        : badge === 'atm'
          ? t.smsInbox.reasonCashWithdrawal
          : badge === 'card-bill'
            ? t.smsInbox.reasonCardBill
            : badge === 'refund'
              ? t.smsInbox.reasonRefund
              : null;

  const cardShort = row.accountTail ? fill(t.smsInbox.cardShort, { tail: row.accountTail }) : null;

  // Read off the messages already on the device — no query, no new column.
  const history = seenBefore(rows, row);
  const historyLine =
    history && history.total !== null
      ? fill(plural(locale, history.count, t.smsInbox.seenBefore), {
          merchant: name,
          amount: formatMoney({ minor: history.total, currency: history.currency }, { locale }),
        })
      : null;

  // The guess is never stored as the starting selection — leaving `category`
  // null means "use whatever `useSmsRowPlacement` would guess", so a person
  // who never touches the row gets exactly the category the old screen always
  // produced. Tapping a chip only ever narrows that to an explicit choice.
  const guessedCategory = merchantName(row.merchant)
    ? guessCategory(merchantName(row.merchant)!)
    : null;
  const selectedCategoryId = category?.id ?? guessedCategory;
  const quickPicks = quickCategoryPicks(guessedCategory);

  const highlights =
    row.body !== ''
      ? findHighlightSpans(row.body, {
          amount: row.amount,
          currency: row.currency,
          merchant: row.merchant,
          occurredOn: row.occurredOn,
        })
      : [];

  const copyBody = async (): Promise<void> => {
    await Clipboard.setStringAsync(row.body);
    toast.show(t.smsInbox.copiedToClipboard);
  };

  const afterPlacement = (ok: boolean): void => {
    if (ok) router.back();
  };

  const onChoose = (choice: DestinationChoice): void => {
    if (choice.kind === 'me') {
      setPickerOpen(false);
      void placement.placePersonal(row, category).then(afterPlacement);
    } else if (choice.kind === 'existing') {
      setPickerOpen(false);
      void placement.chooseExistingGroup(row, choice.groupId, category).then(afterPlacement);
    }
  };

  const onResolvePeople = (names: string[]): void => {
    setPickerOpen(false);
    void placement.assignToNewPeople(row, names, category).then(afterPlacement);
  };

  return (
    <Screen edges={['top']}>
      <Row
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.md}
            color={theme.color.text}
          />
        </IconButton>
        <Text variant="title" style={{ flex: 1 }} numberOfLines={1}>
          {t.smsInbox.detailTitle}
        </Text>
        <IconButton label={t.smsInbox.forget} onPress={() => void forget()}>
          <Ionicons name="trash-outline" size={iconSize.md} color={theme.color.negative} />
        </IconButton>
      </Row>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.lg,
        }}
      >
        {/* The summary: what the app made of it, and what it is for. */}
        <Card style={{ gap: theme.spacing.md }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <Avatar name={name} size={48} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="subheading" numberOfLines={1}>
                {name}
              </Text>
              <Row style={{ gap: theme.spacing.xs, flexWrap: 'wrap' }}>
                <Text variant="caption" tone="muted">
                  {dateSubtitle}
                </Text>
                {statusPill ? <Badge label={statusPill.label} tone={statusPill.tone} /> : null}
              </Row>
            </View>
            <MoneyText
              amount={amount}
              currency={row.currency}
              locale={locale}
              variant="heading"
              tone={row.kind === SmsKind.Income ? 'positive' : undefined}
            />
          </Row>

          {bank || cardShort ? (
            <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
              <Ionicons name="card-outline" size={iconSize.sm} color={theme.color.textMuted} />
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {[bank, cardShort].filter(Boolean).join(' · ')}
              </Text>
            </Row>
          ) : null}

          {reason || badgeLabel || doubts.length > 0 ? (
            <Row style={{ gap: theme.spacing.xs, flexWrap: 'wrap' }}>
              {reason ? <Badge label={reason} /> : null}
              {badgeLabel ? <Badge label={badgeLabel} /> : null}
              {doubts.includes('date-inferred') ? (
                <Badge label={t.smsInbox.dateGuessed} tone="negative" />
              ) : null}
              {doubts.includes('hard-to-read') ? (
                <Badge label={t.smsInbox.hardToRead} tone="negative" />
              ) : null}
            </Row>
          ) : null}

          {historyLine || history?.recurring ? (
            <Row style={{ gap: theme.spacing.xs, flexWrap: 'wrap', alignItems: 'center' }}>
              {historyLine ? (
                <Text variant="caption" tone="muted" style={{ flexShrink: 1 }}>
                  {historyLine}
                </Text>
              ) : null}
              {history?.recurring ? <Badge label={t.smsInbox.recurringChip} tone="brand" /> : null}
            </Row>
          ) : null}

          <Divider />

          {/* The quick category picks: guessed first, "More" always last into
              the full catalog. Choosing one is what the expense gets filed
              under — see `useSmsRowPlacement`'s `category` argument. */}
          <Row style={{ gap: theme.spacing.sm }}>
            {quickPicks.map((id) => (
              <CategoryQuickPick
                key={id}
                id={id}
                label={t.categories[id as keyof typeof t.categories]}
                selected={selectedCategoryId === id}
                onPress={() => setCategory({ id, meta: null })}
              />
            ))}
            <CategoryQuickPick
              id={null}
              icon="ellipsis-horizontal"
              label={t.smsInbox.categoryMore}
              selected={
                selectedCategoryId !== null &&
                !quickPicks.includes(selectedCategoryId as CategoryId)
              }
              onPress={() => setCategorySheetOpen(true)}
            />
          </Row>
        </Card>

        {/* Where it came from — small facts, but they are how a person tells
            two cards apart and recognises a bank they trust. */}
        <InfoStrip row={row} locale={locale} now={now} t={t} />

        {/* The message itself — the whole reason this screen exists, and the
            one place in the app where a bank's own words are shown back. */}
        <Card>
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <Ionicons name="chatbubble-outline" size={iconSize.sm} color={theme.color.textMuted} />
            <Text variant="micro" tone="muted" style={{ flex: 1 }}>
              {t.smsInbox.fromTheMessage}
            </Text>
            {row.body !== '' ? (
              <Button
                label={t.smsInbox.copyText}
                variant="secondary"
                size="sm"
                onPress={() => void copyBody()}
                icon={<Ionicons name="copy-outline" size={13} color={theme.color.brand} />}
              />
            ) : null}
          </Row>
          <Text variant="body" style={{ marginTop: theme.spacing.sm }} selectable>
            {row.body === '' ? (
              t.smsInbox.messageUnavailable
            ) : (
              <HighlightedBody body={row.body} spans={highlights} t={t} />
            )}
          </Text>
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs, marginTop: theme.spacing.md }}>
            <Ionicons name="phone-portrait-outline" size={iconSize.sm} color={theme.color.brand} />
            <Text variant="micro" tone="muted">
              {t.smsInbox.onThisPhoneOnly}
            </Text>
          </Row>
        </Card>

        {/* What do you want to do? */}
        {row.settledAs === null ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="caption" tone="muted">
              {t.smsInbox.whatNext}
            </Text>
            <DetailActionRow
              icon="checkmark-circle"
              label={t.smsInbox.createExpense}
              filled
              disabled={placement.placing}
              onPress={() => setPickerOpen(true)}
            />
            <DetailActionRow
              icon="time-outline"
              label={plural(locale, 1, t.smsInbox.setAside)}
              onPress={() => void setAside()}
            />
            <DetailActionRow
              icon="ban-outline"
              label={t.smsInbox.ignoreMessage}
              onPress={() => void forget()}
            />
          </View>
        ) : (
          <Button label={t.smsInbox.undo} variant="secondary" onPress={() => void bringBack()} />
        )}
      </ScrollView>

      {/* The same picker the Bank messages list and the voice review open, so
          "where does this go?" is one control in the app rather than three. */}
      <Sheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        padded={false}
        closeLabel={t.common.close}
        style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.md, maxHeight: '80%' }}
      >
        <Text variant="heading">{t.captures.assignTitle}</Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ flexShrink: 1 }}
        >
          <DestinationPicker
            key={pickerOpen ? 'open' : 'closed'}
            selection={{ kind: 'none' }}
            eyebrow={null}
            subject={{
              title: (
                <MoneyText
                  amount={amount}
                  currency={row.currency}
                  locale={locale}
                  variant="subheading"
                />
              ),
              note: (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {name}
                </Text>
              ),
            }}
            pinned={['me']}
            createRow={null}
            emptyGroups={t.captures.noGroups}
            groups={placement.assignableGroups}
            people={placement.peopleChoices}
            t={t}
            onChoose={onChoose}
            onResolvePeople={onResolvePeople}
          />
        </ScrollView>
      </Sheet>

      {categorySheetOpen ? (
        <CategorySheet
          value={selectedCategoryId}
          onChange={(key, meta) => {
            setCategory({ id: key, meta });
            setCategorySheetOpen(false);
          }}
          onClose={() => setCategorySheetOpen(false)}
        />
      ) : null}
    </Screen>
  );
}

/** One round category chip: guessed or chosen, highlighted when selected,
 *  "More" (`id: null`) opening the full catalog. */
function CategoryQuickPick({
  id,
  icon,
  label,
  selected,
  onPress,
}: {
  id: CategoryId | null;
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 4,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: selected ? 2 : 0,
          borderColor: theme.color.brand,
          backgroundColor: selected ? theme.color.brandSoft : theme.color.surfaceMuted,
        }}
      >
        {id ? (
          <CategoryBadge category={id} meta={null} size={28} />
        ) : (
          <Ionicons
            name={icon ?? 'ellipsis-horizontal'}
            size={18}
            color={selected ? theme.color.brand : theme.color.textMuted}
          />
        )}
      </View>
      <Text
        variant="micro"
        numberOfLines={1}
        style={{ color: selected ? theme.color.brand : theme.color.textMuted }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** "Sent by …" / "Card ending …" / "Read …" — three cells, two dividers, each
 *  already a full sentence in `t.smsInbox` so this never invents new strings
 *  for the same facts the old screen stated as a stacked list. */
function InfoStrip({
  row,
  locale,
  now,
  t,
}: {
  row: { sender: string | null; accountTail: string | null; readAt: string };
  locale: string;
  now: number;
  t: ReturnType<typeof useStrings>['t'];
}) {
  const theme = useTheme();
  const cells = [
    row.sender
      ? row.sender.replace(row.sender, fill(t.smsInbox.sentBy, { sender: row.sender }))
      : null,
    row.accountTail ? fill(t.smsInbox.cardEnding, { tail: row.accountTail }) : null,
    fill(t.smsInbox.readOn, {
      // Clamped for the same reason `WatchingLine` clamps: the screen's clock
      // ticks once a minute and this row was read on the minute, so for up to
      // sixty seconds "when it was read" is ahead of "now" and renders as "in
      // 1 second".
      when: relativeTime(locale, row.readAt, Math.max(now, Date.parse(row.readAt) || now)),
    }),
  ].filter((cell): cell is string => cell !== null);

  return (
    <Card style={{ flexDirection: 'row', paddingVertical: theme.spacing.md }}>
      {cells.map((cell, index) => (
        <View key={index} style={{ flex: 1, flexDirection: 'row' }}>
          {index > 0 ? (
            <View
              style={{
                width: 1,
                backgroundColor: theme.color.border,
                marginHorizontal: theme.spacing.sm,
              }}
            />
          ) : null}
          <Text variant="micro" tone="muted" numberOfLines={2} style={{ flex: 1 }}>
            {cell}
          </Text>
        </View>
      ))}
    </Card>
  );
}

const HIGHLIGHT_TINT: Record<HighlightKind, 'lilac' | 'mint' | 'peach'> = {
  amount: 'lilac',
  date: 'mint',
  merchant: 'peach',
};

const HIGHLIGHT_A11Y: Record<
  HighlightKind,
  'highlightAmount' | 'highlightDate' | 'highlightMerchant'
> = {
  amount: 'highlightAmount',
  date: 'highlightDate',
  merchant: 'highlightMerchant',
};

/**
 * The message body, with the amount/date/merchant spans picked out as soft
 * rounded backgrounds. Each highlighted run is also announced for
 * accessibility — "Amount, ₹1,250" — rather than made tappable: the detail a
 * misread deserves is already one tap away through the category picks and the
 * ordinary edit path, and a highlight that looks interactive but corrects
 * nothing would be worse than one that is simply readable.
 */
function HighlightedBody({
  body,
  spans,
  t,
}: {
  body: string;
  spans: readonly HighlightSpan[];
  t: ReturnType<typeof useStrings>['t'];
}) {
  const theme = useTheme();
  if (spans.length === 0) return <>{body}</>;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    if (span.start > cursor) nodes.push(body.slice(cursor, span.start));
    const value = body.slice(span.start, span.end);
    const tint = theme.tint[HIGHLIGHT_TINT[span.kind]];
    const label = fill(t.smsInbox[HIGHLIGHT_A11Y[span.kind]], { value });
    nodes.push(
      <RNText
        key={`${span.kind}-${index}`}
        accessible
        accessibilityLabel={label}
        style={{ backgroundColor: tint.bg, color: tint.ink, borderRadius: 4 }}
      >
        {value}
      </RNText>,
    );
    cursor = span.end;
  });
  if (cursor < body.length) nodes.push(body.slice(cursor));

  return <>{nodes}</>;
}

/** One row under "What do you want to do?" — a filled brand row for the
 *  primary action, secondary for the other two. */
function DetailActionRow({
  icon,
  label,
  onPress,
  disabled = false,
  filled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  filled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Button
      label={label}
      variant={filled ? 'primary' : 'secondary'}
      fullWidth
      disabled={disabled}
      onPress={onPress}
      icon={
        <Ionicons
          name={icon}
          size={iconSize.md}
          color={filled ? theme.color.onBrand : theme.color.brand}
        />
      }
    />
  );
}
