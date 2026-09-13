/**
 * Bank messages into drafts.
 *
 * This is the SMS feature, and on an iPhone it is the whole of it. iOS has no
 * API that reads Messages at any tier, and Android's `READ_SMS` is restricted —
 * held without an approved core use case it is grounds for removal from Play,
 * not a rejected update (`docs/plan-drafts-and-rules.md` §1). So the honest
 * design is the one where a person hands the messages over, and it is complete
 * on its own rather than a fallback for a reader that is not there.
 *
 * A build made with `WAVES_SMS_READER=1`, on Android, for somebody in the
 * `sms_inbox_read` treatment arm, gets one extra button here: it leads to a
 * disclosure screen (`./messages`), never straight to the system prompt.
 * Everything downstream of that button — the found list, the ticking, the
 * writing — is this screen, unchanged.
 *
 * WHERE THINGS GO. Each ticked payment becomes a `captures` row: an expense
 * with no group yet, which is what the Review tab has held since A34. Not a
 * second inbox (#565 undid that once already), not an expense in a group —
 * nothing here knows who was there, and the parser deliberately does not guess
 * at a split.
 *
 * WHAT IS NOT SENT. Parsing is on-device (ADR-013): a bank message carries an
 * account tail, a balance and sometimes a one-time password. The text of a
 * pasted message rides along as `rawText` the way a scanned receipt's OCR does
 * — a person put it there themselves. The text of a *read* message never does;
 * `lib/smsDrafts.ts` is where that is decided, and a test pins it. And nothing
 * on this screen reports anything at all: no Sentry event, no Clarity event,
 * not even a count. A paste that parses badly is said to the person in front of
 * it, and to nobody else.
 *
 * WHY IT IS A FLASHLIST. A month of statements is a hundred rows, and this is
 * the screen the plan points the backfill at. The paste box and the intro ride
 * as the list header so there is one scroll region rather than a list nested in
 * a ScrollView, which does not virtualise at all.
 */

import { useCallback, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { Pressable, TextInput, View } from 'react-native';

import { proposeFromSms, type ExpenseCandidate, type SmsMessage } from '@waves/core';
import {
  Badge,
  Button,
  Callout,
  Card,
  Divider,
  EmptyState,
  IconButton,
  iconSize,
  MoneyText,
  Row,
  Screen,
  SectionHeader,
  Text,
  useTheme,
} from '@waves/ui';

import { dayHeading } from '@/data/activity';
import { useCaptures, useCreateCapture } from '@/data/hooks';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { friendlyError } from '@/lib/errors';
import { useGuestGuard } from '@/lib/guestGuard';
import { router } from '@/lib/navigation';
import { smsCaptureId } from '@/lib/smsCaptureId';
import {
  bodiesByKey,
  planSmsDrafts,
  splitMessages,
  unreadableCount,
  type SmsDraftProvenance,
} from '@/lib/smsDrafts';
import { useSmsInboxReader } from '@/lib/smsFeature';
import { takeReadMessages } from '@/lib/smsReadBridge';

/** A day heading, or one payment under it. */
type FoundItem =
  | { kind: 'day'; key: string; at: string }
  | { kind: 'candidate'; key: string; candidate: ExpenseCandidate };

/**
 * One found payment: a tick, the shop, the amount.
 *
 * The date is not on the row — the day heading above it already carries that,
 * which is the point of grouping. What the row's second line carries instead is
 * everything that would make a person hesitate: which bank said it, which card
 * it was, and — the one that matters most on a trip — whether the day came from
 * the message or was only the day it arrived.
 */
function FoundRow({
  candidate,
  picked,
  locale,
  t,
  onToggle,
}: {
  candidate: ExpenseCandidate;
  picked: boolean;
  locale: string;
  t: UiStrings;
  onToggle: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const title = candidate.merchant ?? t.smsImport.cardPayment;
  const parts: string[] = [];
  if (candidate.sender) parts.push(candidate.sender);
  if (candidate.accountTail) parts.push(`⋯${candidate.accountTail}`);
  if (candidate.dateInferred) parts.push(t.smsImport.dateNotInMessage);
  const subtitle = parts.join(' · ');

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: picked }}
      accessibilityLabel={`${title}, ${picked ? t.smsImport.selected : t.smsImport.notSelected}`}
      onPress={onToggle}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Row
        style={{
          gap: theme.spacing.md,
          alignItems: 'center',
          paddingVertical: theme.spacing.sm,
          minHeight: 52,
        }}
      >
        {/* Never colour alone: the tick is a different glyph, not just a
            different shade, and the a11y state says it a third way (#191). */}
        <Ionicons
          name={picked ? 'checkbox' : 'square-outline'}
          size={iconSize.xxl}
          color={picked ? theme.color.brand : theme.color.textFaint}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="subheading" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <MoneyText
            amount={candidate.amount.minor}
            currency={candidate.amount.currency}
            locale={locale}
            variant="subheading"
          />
          {/* A message we only half understood is not pre-ticked, and says so
              rather than simply sitting there unticked for no visible reason. */}
          {candidate.preselect ? null : <Badge label={t.smsImport.checkThis} />}
        </View>
      </Row>
    </Pressable>
  );
}

export default function PasteMessagesScreen(): React.JSX.Element {
  const theme = useTheme();
  const clearance = useBottomClearance(theme.spacing.xl);
  const { t, locale } = useStrings();
  const { session } = useAuth();
  const ownerId = session?.user?.id ?? '';
  const guard = useGuestGuard();
  const createCapture = useCreateCapture();
  const captures = useCaptures();
  // Both gates, asked once: Android, a build that declares the permission, and
  // the treatment arm. False everywhere else, including every iPhone.
  const readerOffered = useSmsInboxReader();

  const [blob, setBlob] = useState('');
  // Messages read from the inbox, kept apart from the pasted ones so each keeps
  // its real received time — a dateless bank SMS is filed on the day it
  // arrived, which a paste (received "now") cannot know. Held in state for the
  // life of this screen and written to disk by nothing.
  const [readMessages, setReadMessages] = useState<readonly SmsMessage[]>([]);
  // Explicit ticks, over the parser's own pre-selection. Absent means "whatever
  // `preselect` said", so a person who ticks nothing still gets the sensible set.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  // The disclosure screen leaves what it read here and pops. On focus rather
  // than on mount: this screen is never unmounted while the disclosure is up,
  // so a mount effect would have run long before there was anything to collect.
  // `takeReadMessages` reads and clears in one step, so a later visit — or a
  // second focus after nothing happened — picks up nothing.
  useFocusEffect(
    useCallback(() => {
      const handed = takeReadMessages();
      if (handed && handed.length > 0) {
        setReadMessages((current) => [...current, ...handed]);
        setError(null);
      }
    }, []),
  );

  const pastedBlocks = useMemo(() => splitMessages(blob), [blob]);
  const pasted = useMemo(
    () =>
      pastedBlocks.map((body) => ({
        body,
        // A pasted message carries no arrival time of its own, so "now" stands
        // in — and every candidate built from one that named no date is marked
        // `dateInferred`, which the row says out loud.
        receivedAt: new Date().toISOString(),
      })),
    [pastedBlocks],
  );

  // Read first, so that when the same message is both read and pasted the read
  // one wins the dedupe — and therefore the stricter no-body rule applies.
  const candidates = useMemo(
    () => proposeFromSms([...readMessages, ...pasted]),
    [readMessages, pasted],
  );

  // Which of these came out of the inbox. Computed from the read messages alone
  // rather than inferred from what is missing, so a body can never be attached
  // to a read draft by an accident of ordering.
  const readKeys = useMemo(
    () => new Set(proposeFromSms(readMessages).map((item) => item.dedupeKey)),
    [readMessages],
  );

  const bodies = useMemo(() => bodiesByKey(pasted), [pasted]);

  // Drafts already waiting in Review, by the key of the message behind them.
  // Named rather than hidden: a re-paste that silently showed fewer rows than
  // the person pasted would read as the parser having failed.
  //
  // This is the *visible* half of the guarantee and only covers drafts still
  // open — `useCaptures` drops the ones already filed into a group. The durable
  // half is the id: `smsCaptureId` derives it from the message, so a payment
  // that has since become an expense is written again as the same row id, and
  // `capture.create` answers that with the success it already achieved rather
  // than a second draft. Re-pasting a whole month is safe; it just cannot say
  // "already added" about the part of it that has since been filed.
  const alreadyKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of captures.data ?? []) {
      const key = (row.parsed as SmsDraftProvenance | null)?.dedupeKey;
      if (typeof key === 'string') keys.add(key);
    }
    return keys;
  }, [captures.data]);

  const fresh = useMemo(
    () => candidates.filter((item) => !alreadyKeys.has(item.dedupeKey)),
    [candidates, alreadyKeys],
  );
  const alreadyCount = candidates.length - fresh.length;
  // How many pasted blocks produced nothing. Only pasted ones are counted: a
  // read window sweeps up every message in it, most of which are not payments,
  // and "412 of those were not payments" would be noise rather than news.
  const notPayments = useMemo(() => unreadableCount(pastedBlocks), [pastedBlocks]);

  const chosen = useMemo(() => {
    const keys = new Set<string>();
    for (const item of fresh) {
      if (ticks[item.dedupeKey] ?? item.preselect) keys.add(item.dedupeKey);
    }
    return keys;
  }, [fresh, ticks]);

  const feed = useMemo((): FoundItem[] => {
    const items: FoundItem[] = [];
    let day = '';
    for (const candidate of fresh) {
      const candidateDay = candidate.at.slice(0, 10);
      if (candidateDay !== day) {
        day = candidateDay;
        items.push({ kind: 'day', key: `day-${candidateDay}`, at: candidate.at });
      }
      items.push({ kind: 'candidate', key: candidate.dedupeKey, candidate });
    }
    return items;
  }, [fresh]);

  const toggle = useCallback((key: string, next: boolean): void => {
    setTicks((current) => ({ ...current, [key]: next }));
  }, []);

  const paste = useCallback(async (): Promise<void> => {
    const text = await Clipboard.getStringAsync();
    if (!text.trim()) return;
    setBlob((current) => (current ? `${current}\n\n${text}` : text));
  }, []);

  /**
   * Write the ticked payments as drafts.
   *
   * Each id is derived from the message (`smsCaptureId`), so pasting the same
   * statement next week produces the same ids and the second run writes nothing
   * — the database is what enforces that, not this screen's memory of it. Each
   * draft is its own attempt: one that refuses does not take the others down,
   * and the count that is reported is the count that actually landed.
   */
  const add = useCallback(async (): Promise<void> => {
    if (saving) return;
    if (guard.blockWrite()) return;
    if (!ownerId) return;

    const drafts = planSmsDrafts({ candidates: fresh, chosen, readKeys, bodies });
    if (drafts.length === 0) return;

    setSaving(true);
    setError(null);
    let placed = 0;
    try {
      for (const draft of drafts) {
        const captureId = await smsCaptureId(ownerId, draft.dedupeKey);
        await createCapture.mutateAsync({
          captureId,
          description: draft.description,
          category: draft.category,
          expenseDate: draft.expenseDate,
          currency: draft.currency,
          amount: draft.amount,
          rawText: draft.rawText,
          parsed: { ...draft.parsed },
        });
        placed += 1;
      }
      setAdded(placed);
      setBlob('');
      setTicks({});
      setReadMessages([]);
    } catch (caught) {
      setAdded(placed > 0 ? placed : null);
      setError(friendlyError(caught, t.captures.couldNotSave, 'smsImport.addDrafts'));
    } finally {
      setSaving(false);
    }
  }, [
    bodies,
    chosen,
    createCapture,
    fresh,
    guard,
    ownerId,
    readKeys,
    saving,
    t.captures.couldNotSave,
  ]);

  const header = (
    <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.md }}>
      <Row style={{ paddingTop: theme.spacing.md, alignItems: 'center' }}>
        <IconButton label={t.common.close} onPress={() => router.back()}>
          <Ionicons name="close" size={iconSize.xl} color={theme.color.text} />
        </IconButton>
        <Text variant="subheading" style={{ marginLeft: theme.spacing.md, flex: 1 }}>
          {t.smsImport.title}
        </Text>
      </Row>

      <Card style={{ gap: theme.spacing.sm }}>
        <Text variant="caption" tone="muted">
          {t.smsImport.howToDrafts}
        </Text>
        {/* Why there is no switch for this. Said only where it is true: a build
            that can read the inbox has the button below instead, and the
            sentence would contradict it. */}
        {readerOffered ? null : (
          <Text variant="micro" tone="muted">
            {t.smsImport.whyNotAutomatic}
          </Text>
        )}
      </Card>

      {readerOffered ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t.smsImport.readMessages}
            variant="secondary"
            onPress={() => router.push('/captures/messages')}
            icon={
              <Ionicons name="chatbubbles-outline" size={iconSize.md} color={theme.color.brand} />
            }
          />
          <Text variant="micro" tone="muted">
            {t.smsImport.readOnAndroid}
          </Text>
          {readMessages.length > 0 ? (
            <Text variant="micro" tone="muted">
              {plural(locale, readMessages.length, t.smsImport.readCount)}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        <SectionHeader title={t.smsImport.messagesSection} />
        <Card style={{ gap: theme.spacing.sm }}>
          <TextInput
            value={blob}
            onChangeText={setBlob}
            multiline
            autoCapitalize="none"
            accessibilityLabel={t.smsImport.pasteLabel}
            placeholder={t.smsImport.pastePlaceholder}
            placeholderTextColor={theme.color.textFaint}
            style={{
              minHeight: 140,
              fontSize: 15,
              color: theme.color.text,
              textAlignVertical: 'top',
            }}
          />
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="micro" tone="muted">
              {pastedBlocks.length === 0
                ? t.smsImport.nothingPasted
                : plural(locale, pastedBlocks.length, t.smsImport.messageCount)}
            </Text>
            <Button label={t.smsImport.paste} variant="ghost" onPress={() => void paste()} />
          </Row>
        </Card>
      </View>

      {/* Only over a list that has something in it. With nothing found, the
          empty state below carries the same two sentences and this would say
          them twice. */}
      {fresh.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          {/* An eyebrow over a question, not a noun over a list: the list has
              one thing to ask and the button below is the answer. */}
          <Text variant="micro" tone="muted" style={{ textTransform: 'uppercase' }}>
            {t.smsImport.foundSection}
          </Text>
          <Text variant="heading">{t.smsImport.foundQuestion}</Text>
          {/* Everything the parser could not use, said plainly. A screen that
              quietly shows four rows for six messages reads as broken. */}
          {notPayments > 0 ? (
            <Text variant="micro" tone="muted">
              {plural(locale, notPayments, t.smsImport.someNotParsed)}
            </Text>
          ) : null}
          {alreadyCount > 0 ? (
            <Text variant="micro" tone="muted">
              {plural(locale, alreadyCount, t.smsImport.alreadyAdded)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const footer = (
    <View style={{ gap: theme.spacing.md, paddingTop: theme.spacing.lg }}>
      {error ? <Callout tone="negative">{error}</Callout> : null}
      {added !== null ? (
        <Callout tone="positive">{plural(locale, added, t.smsImport.addedDraftCount)}</Callout>
      ) : null}
      <Button
        label={
          saving
            ? t.smsImport.adding
            : chosen.size === 0
              ? t.smsImport.nothingSelected
              : plural(locale, chosen.size, t.smsImport.addDraftCount)
        }
        onPress={() => void add()}
        disabled={chosen.size === 0 || saving}
      />
    </View>
  );

  const renderItem = useCallback(
    ({ item }: { item: FoundItem }) => {
      if (item.kind === 'day') {
        return (
          <Text
            variant="micro"
            tone="muted"
            style={{
              textTransform: 'uppercase',
              marginTop: theme.spacing.md,
              marginBottom: theme.spacing.xs,
            }}
          >
            {dayHeading(locale, item.at)}
          </Text>
        );
      }
      const picked = chosen.has(item.candidate.dedupeKey);
      return (
        <View>
          <FoundRow
            candidate={item.candidate}
            picked={picked}
            locale={locale}
            t={t}
            onToggle={() => toggle(item.candidate.dedupeKey, !picked)}
          />
          <Divider />
        </View>
      );
    },
    [chosen, locale, t, theme.spacing.md, theme.spacing.xs, toggle],
  );

  return (
    <Screen edges={['top']}>
      <FlashList
        data={feed}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        getItemType={(item) => item.kind}
        // The group-ledger settings: `extraData` because a tick changes a row
        // that FlashList would otherwise recycle unchanged, and the drop
        // distance so a pasted month scrolls without blanking.
        extraData={chosen}
        drawDistance={1500}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
        }}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          // Nothing handed over yet is not an empty result; it is a screen
          // waiting to be used, and the paste box above already says so.
          pastedBlocks.length === 0 && readMessages.length === 0 ? null : (
            <EmptyState
              title={t.smsImport.nothingToImport}
              // Why there is nothing, in the honest order: because you have
              // them already, or because none of it was a payment. Never a
              // blank list with no account of itself.
              body={
                alreadyCount > 0
                  ? plural(locale, alreadyCount, t.smsImport.alreadyAdded)
                  : t.smsImport.nothingLikeAPayment
              }
            />
          )
        }
      />
    </Screen>
  );
}
