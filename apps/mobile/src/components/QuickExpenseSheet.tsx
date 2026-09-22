/**
 * The quick expense sheet — the short way from "I just paid for something" to a
 * saved expense.
 *
 * The dashboard's "add expense" used to open the capture screen, which is the
 * right screen for a spend that does not know where it belongs yet: it asks
 * about the description, the category, the day, the payment rail, a photo. Most
 * of the time none of that is in question. You are at a table, you paid 480, it
 * goes on the flat. This sheet is that case and only that case: an amount, the
 * currency it was in, where it goes, and save.
 *
 * **Everything it does not ask is one tap away, not lost.** "More details"
 * carries the amount, currency, place and location it already has into the full
 * form and closes the sheet, so nothing typed here is typed twice. That is the
 * pressure valve which lets the sheet stay this short: it never has to grow a
 * field for the case it cannot handle, it hands that case on.
 *
 * ## Where the chips come from
 *
 * The five destinations are the ones you last filed an expense to
 * (`recentDestinations`), which is recorded on the device as expenses are saved.
 * Before that store has anything in it — a new install, or a reinstall — the row
 * is topped up from the group list so it is never half empty, and the picker is
 * one tap below it either way.
 *
 * NOT YET: on an install with no history the fallback should be `suggestGroup`,
 * the engine Review uses, which weighs a running trip and where this category
 * has been filed before and stays quiet when it is not sure. Today the fallback
 * is the plain group list, which is newest-created order and says nothing about
 * habit.
 *
 * ## What it refuses to do
 *
 * Two cases leave rather than being half-handled here:
 *
 *  - **A currency the group does not keep its books in.** Nothing is converted
 *    on its own (ADR-003); a foreign amount needs a rate, and the rate card is
 *    the full form's. The sheet says so and offers the way through.
 *  - **People who do not already share a group.** Filing with somebody new
 *    means creating a group and a ghost for them — a real, lasting thing, and
 *    not what a sheet called "quick" should do behind one tap. The picker's
 *    People tab hands those to the capture screen instead.
 *
 * ## What it saves
 *
 * An equal split across the group, with you as the payer, stated in words under
 * the chips so it is never a surprise. The split is the one nearly every quick
 * spend wants; anything else is the full form, which is a tap away. The write
 * goes through the same durable queue every other expense uses, so it saves
 * with no network and syncs later.
 */
import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { currencySymbol } from '@waves/core';
import {
  AmountField,
  Button,
  Callout,
  Divider,
  iconSize,
  Row,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

import { DestinationPicker } from '@/components/DestinationPicker';
import { GroupMark } from '@/components/GroupMark';
import { useGroup, useGroups, useWriteExpense } from '@/data/hooks';
import { groupLabel, isViewer, type GroupRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useDefaultCurrency } from '@/lib/currency';
import { COMMON_CURRENCIES } from '@/lib/currencyChoices';
import { router } from '@/lib/navigation';
import { groupDestination, noteDestination, useRecentDestinations } from '@/lib/recentDestinations';

/** How many chips the row offers. More than this and the row stops being a
    glance and starts being a list — which is what the picker is for. */
const CHIPS = 5;

export function QuickExpenseSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { t } = useStrings();
  const defaultCurrency = useDefaultCurrency();
  const groups = useGroups();
  const recents = useRecentDestinations();

  const [amount, setAmount] = useState(0n);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickingCurrency, setPickingCurrency] = useState(false);

  const rows = useMemo(() => groups.data ?? [], [groups.data]);
  const byId = useMemo(() => new Map(rows.map((group) => [group.id, group])), [rows]);

  /**
   * The chips: recent first, then whatever else is to hand.
   *
   * A key that no longer resolves is dropped rather than drawn — a group can be
   * left, archived or deleted between the save that recorded it and this sheet —
   * and the row is topped up from the group list so it is never half empty on a
   * device that has only filed to one place.
   */
  const chips = useMemo(() => {
    const seen = new Set<string>();
    const out: GroupRow[] = [];
    const take = (group: GroupRow | undefined): void => {
      if (!group || seen.has(group.id) || out.length >= CHIPS) return;
      seen.add(group.id);
      out.push(group);
    };
    for (const key of recents.keys) {
      const id = key.startsWith('group:') ? key.slice('group:'.length) : null;
      if (id) take(byId.get(id));
    }
    for (const group of rows) take(group);
    return out;
  }, [recents.keys, byId, rows]);

  const chosen = chosenId ? byId.get(chosenId) : undefined;

  return (
    <Sheet visible={visible} onClose={onClose} title={t.quickExpense.title}>
      <View style={{ gap: theme.spacing.lg }}>
        <View style={{ alignItems: 'center' }}>
          <AmountField currency={currency} value={amount} onChange={setAmount} autoFocus />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={currency}
            onPress={() => setPickingCurrency((open) => !open)}
            style={{ paddingVertical: theme.spacing.xs }}
          >
            <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
              <Text variant="caption" tone="muted">
                {currencySymbol(currency)} {currency}
              </Text>
              <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
            </Row>
          </Pressable>
        </View>

        {pickingCurrency ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Row style={{ gap: theme.spacing.sm }}>
              {COMMON_CURRENCIES.map((code) => (
                <Pressable
                  key={code}
                  accessibilityRole="button"
                  accessibilityState={{ selected: code === currency }}
                  onPress={() => {
                    setCurrency(code);
                    setPickingCurrency(false);
                  }}
                  style={{
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.pill,
                    backgroundColor:
                      code === currency ? theme.color.brandSoft : theme.color.surfaceMuted,
                  }}
                >
                  <Text variant="caption" tone={code === currency ? 'brand' : 'default'}>
                    {code}
                  </Text>
                </Pressable>
              ))}
            </Row>
          </ScrollView>
        ) : null}

        <Divider />

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" tone="muted">
            {t.quickExpense.where}
          </Text>
          {chips.length === 0 ? (
            <Text variant="caption" tone="faint">
              {t.quickExpense.noPlacesYet}
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Row style={{ gap: theme.spacing.sm }}>
                {chips.map((group) => (
                  <Pressable
                    key={group.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: group.id === chosenId }}
                    onPress={() => setChosenId(group.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.xs,
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.sm,
                      borderRadius: theme.radius.pill,
                      backgroundColor:
                        group.id === chosenId ? theme.color.brandSoft : theme.color.surfaceMuted,
                    }}
                  >
                    <GroupMark emoji={group.cover_emoji} size={20} />
                    <Text
                      variant="caption"
                      numberOfLines={1}
                      tone={group.id === chosenId ? 'brand' : 'default'}
                    >
                      {groupLabel(group)}
                    </Text>
                  </Pressable>
                ))}
              </Row>
            </ScrollView>
          )}

          <Pressable accessibilityRole="button" onPress={() => setPickerOpen(true)}>
            <Text variant="caption" tone="brand">
              {t.quickExpense.otherPlaces}
            </Text>
          </Pressable>
        </View>

        {chosen ? (
          <QuickExpenseFooter
            group={chosen}
            amount={amount}
            currency={currency}
            onSaved={onClose}
            onHandOff={onClose}
          />
        ) : (
          <Button
            label={t.quickExpense.save}
            size="lg"
            fullWidth
            disabled
            onPress={() => undefined}
          />
        )}
      </View>

      {pickerOpen ? (
        <Sheet visible onClose={() => setPickerOpen(false)} title={t.quickExpense.where}>
          <DestinationPicker
            selection={chosen ? { kind: 'existing', groupId: chosen.id } : { kind: 'none' }}
            groups={rows}
            people={[]}
            t={t}
            pinned={[]}
            onChoose={(choice) => {
              if (choice.kind === 'existing') setChosenId(choice.groupId);
              setPickerOpen(false);
            }}
            // Somebody this ledger has never met needs a group and a ghost made
            // for them. That is a lasting thing to do behind a sheet called
            // quick, so it goes to the screen built for a spend with no home.
            onResolvePeople={() => {
              setPickerOpen(false);
              onClose();
              router.push('/capture');
            }}
          />
        </Sheet>
      ) : null}
    </Sheet>
  );
}

/**
 * The save, and the sentence above it.
 *
 * Its own component because it needs the chosen group's members, and a hook
 * cannot be called conditionally in the sheet above — the group is chosen after
 * the sheet is already on screen.
 */
function QuickExpenseFooter({
  group,
  amount,
  currency,
  onSaved,
  onHandOff,
}: {
  group: GroupRow;
  amount: bigint;
  currency: string;
  onSaved: () => void;
  onHandOff: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const viewerId = useViewerId();
  const { members } = useGroup(group.id);
  const write = useWriteExpense(group.id);
  const [saving, setSaving] = useState(false);

  const rows = members.data;
  const participants = useMemo(() => rows.map((member) => member.id), [rows]);
  const myMemberId = useMemo(
    () => rows.find((member) => isViewer(member, viewerId))?.id ?? null,
    [rows, viewerId],
  );

  // Nothing is converted on its own (ADR-003). An amount in a currency this
  // group does not keep its books in needs a rate, and the rate card — with the
  // tier rules behind it — is the full form's. Saying so is better than saving
  // a number that means something else.
  const needsRate = currency !== group.default_currency;
  const canSave =
    amount > 0n && participants.length > 0 && myMemberId !== null && !needsRate && !saving;

  const handOff = (): void => {
    onHandOff();
    router.push({
      pathname: '/group/[id]/add-expense',
      params: {
        id: group.id,
        amount: amount.toString(),
        currency,
      },
    });
  };

  const save = async (): Promise<void> => {
    if (!canSave || !myMemberId) return;
    setSaving(true);
    try {
      await write.mutateAsync({
        description: '',
        expenseDate: new Date().toISOString().slice(0, 10),
        currency,
        amount,
        splitParams: { kind: 'equal' },
        participants,
        payers: { [myMemberId]: amount },
        // The same engine the server runs, seeded with nothing yet — the id is
        // minted inside the write, so the preview here is only a check that the
        // split is computable at all.
        expectedShares: undefined,
      });
      noteDestination(groupDestination(group.id));
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {needsRate ? (
        <Callout tone="warning">{t.quickExpense.needsRate}</Callout>
      ) : (
        <Text variant="caption" tone="muted">
          {fill(t.quickExpense.splitEqually, { count: String(participants.length) })}
        </Text>
      )}
      <Button
        label={t.quickExpense.save}
        size="lg"
        fullWidth
        disabled={!canSave}
        onPress={() => void save()}
      />
      <Button label={t.quickExpense.moreDetails} variant="secondary" fullWidth onPress={handOff} />
    </View>
  );
}
