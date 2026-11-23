/**
 * The "Paid by" editor: a lane of people to tap (one payer, or several) and, with
 * several, one figure per payer. Shared by the add-expense form and the voice
 * review sheet, so both pick payers the same way. State lives with the caller
 * (see `usePayersState`); this only draws it.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  currencySymbol,
  format,
  formatMinorInput,
  money,
  rebalancePayers,
  validatePayers,
  type CurrencyCode,
  type MemberId,
} from '@waves/core';
import { amountKeyboard, Row, Text, useTheme } from '@waves/ui';

import { PersonAvatar } from '@/components/PersonAvatar';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import { useStrings } from '@/i18n';
import {
  planCollapseToOne,
  planEvenly,
  planToggle,
  planTypedAmount,
  type PayerPlan,
} from '@/lib/expenseForm';

/** Fixed so the lane is the same shape whatever the names. */
const PAYER_TILE_WIDTH = 60;
const LINK_HIT_SLOP = { top: 15, bottom: 15, left: 8, right: 8 } as const;

export function PayersEditor({
  members,
  viewerId,
  payers,
  paidText,
  manyPayers,
  amount,
  currency,
  message,
  leading,
  onToggle,
  onEntry,
  onEvenly,
  onMany,
}: {
  members: readonly MemberRow[];
  viewerId: string | null | undefined;
  payers: ReadonlyMap<MemberId, bigint>;
  paidText: Record<MemberId, string>;
  manyPayers: boolean;
  amount: bigint;
  currency: string;
  message: string | null;
  /** Extra tiles before the people (the form's family heads). */
  leading?: React.ReactNode;
  onToggle: (memberId: MemberId) => void;
  onEntry: (memberId: MemberId, text: string) => void;
  onEvenly: () => void;
  onMany: (many: boolean) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const payerIds = [...payers.keys()];
  const payerMessage = message;
  // Whoever is paying leads the lane (the sort is stable).
  const payerChoices = useMemo(
    () => [...members].sort((a, b) => Number(payers.has(b.id)) - Number(payers.has(a.id))),
    [members, payers],
  );
  const setManyPayers = onMany;
  const splitPaidEvenly = onEvenly;
  const togglePayer = onToggle;
  const setPaidEntry = onEntry;
  return (
    <View style={{ gap: theme.spacing.sm, paddingBottom: theme.spacing.sm }}>
      <Row style={{ justifyContent: 'flex-end' }}>
        <Row style={{ gap: theme.spacing.lg, alignItems: 'center', flexShrink: 0 }}>
          {manyPayers && payers.size > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.expense.splitPaidEvenly}
              onPress={splitPaidEvenly}
              hitSlop={LINK_HIT_SLOP}
            >
              <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
                {t.expense.splitPaidEvenly}
              </Text>
            </Pressable>
          ) : null}
          {/* The way in and out of several-payer mode. A link
            rather than a hidden long-press: nobody discovers a
            long-press, and this is the whole feature. */}
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: manyPayers }}
            accessibilityLabel={manyPayers ? t.expense.paidByOne : t.expense.paidBySeveral}
            onPress={() => setManyPayers(!manyPayers)}
            hitSlop={LINK_HIT_SLOP}
          >
            <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
              {manyPayers ? t.expense.paidByOne : t.expense.paidBySeveral}
            </Text>
          </Pressable>
        </Row>
      </Row>

      {/* One lane that scrolls, not a grid that reflows. Every
      tile is the same width, the name gets one line and an
      ellipsis, and the overflow goes sideways where a tap can
      reach it. Whoever is paying leads the lane
      (`payerChoices`), so on a long member list the answer is
      at the start rather than somewhere off the right-hand
      edge. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: theme.spacing.xs,
          paddingRight: theme.spacing.xl,
        }}
      >
        {leading}
        {payerChoices.map((member) => {
          const isPayer = payers.has(member.id);
          return (
            <Pressable
              key={member.id}
              // The role follows the mode, because the gesture
              // does: one payer is a radio (tapping replaces),
              // several is a checkbox (tapping adds).
              accessibilityRole={manyPayers ? 'checkbox' : 'radio'}
              accessibilityState={manyPayers ? { checked: isPayer } : { selected: isPayer }}
              accessibilityLabel={`${t.paidBy}: ${displayName(member, viewerId)}`}
              onPress={() => togglePayer(member.id)}
              style={{
                width: PAYER_TILE_WIDTH,
                alignItems: 'center',
                gap: 4,
                opacity: isPayer ? 1 : 0.45,
              }}
            >
              <PersonAvatar member={member} name={displayName(member)} ghost={isGhost(member)} />
              <Text
                variant="micro"
                tone={isPayer ? 'brand' : 'muted'}
                numberOfLines={1}
                style={{ textAlign: 'center' }}
              >
                {displayName(member, viewerId)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {manyPayers && payers.size > 1 ? (
        <View style={{ gap: theme.spacing.xs }}>
          {payerIds.map((memberId) => {
            const member = members.find((row) => row.id === memberId);
            const name = member ? displayName(member, viewerId) : t.misc.someone;
            return (
              <Row key={memberId} style={{ gap: theme.spacing.md, alignItems: 'center' }}>
                <PersonAvatar
                  member={member}
                  name={member ? displayName(member) : name}
                  ghost={member ? isGhost(member) : false}
                  size={32}
                />
                <Text variant="body" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                  {name}
                </Text>
                {/* The figure may be long — a six-figure trip
                  total, a yen amount, a large accessibility
                  font. It gives way to the name rather than
                  clipping, down to a floor wide enough to
                  still read as a field. */}
                <Row
                  style={{
                    gap: theme.spacing.xs,
                    alignItems: 'center',
                    flexShrink: 1,
                    minWidth: 96,
                    maxWidth: '60%',
                  }}
                >
                  <Text variant="caption" tone="muted">
                    {currencySymbol(currency)}
                  </Text>
                  <TextInput
                    value={paidText[memberId] ?? ''}
                    onChangeText={(text) => setPaidEntry(memberId, text)}
                    keyboardType={amountKeyboard(currency as CurrencyCode)}
                    selectTextOnFocus
                    placeholder="0"
                    placeholderTextColor={theme.color.textFaint}
                    accessibilityLabel={t.expense.paidByNameAmount.replace('{name}', name).replace(
                      '{amount}',
                      format(money(payers.get(memberId) ?? 0n, currency), {
                        locale,
                      }),
                    )}
                    // What is wrong with the set of figures, on
                    // each field that can put it right. React
                    // Native has no invalid accessibility state,
                    // so the message itself is the hint —
                    // otherwise the only announcement of a bill
                    // that does not add up arrives at the save
                    // button.
                    accessibilityHint={payerMessage ?? undefined}
                    style={{
                      flexGrow: 1,
                      flexShrink: 1,
                      minWidth: 72,
                      minHeight: 44,
                      fontSize: 16,
                      fontWeight: '700',
                      textAlign: 'right',
                      textAlignVertical: 'center',
                      color: theme.color.text,
                      backgroundColor: theme.color.bg,
                      borderRadius: theme.radius.sm,
                      paddingVertical: theme.spacing.sm,
                      paddingHorizontal: theme.spacing.sm,
                    }}
                  />
                </Row>
              </Row>
            );
          })}
        </View>
      ) : null}

      {/* What is still unaccounted for, or claimed twice over.
      Only once the bill has a total: "₹0 left to assign" on an
      empty form is noise rather than guidance. A single payer
      always holds the whole bill, so there is nothing to
      report — that row gets the hint instead. */}
      {payerMessage && amount > 0n ? (
        <Text
          variant="micro"
          tone="negative"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {payerMessage}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The payer figures and the gestures on them, for a sheet that has no form around
 * it. The same plans (`lib/expenseForm`) and the same arithmetic (`rebalancePayers`
 * in core) the add-expense form runs.
 */
export function usePayersState(input: {
  amount: bigint;
  currency: string;
  seed: string;
  initial: ReadonlyMap<MemberId, bigint>;
}) {
  const { amount, currency, seed } = input;
  const [payers, setPayers] = useState<ReadonlyMap<MemberId, bigint>>(input.initial);
  const [locked, setLocked] = useState<ReadonlySet<MemberId>>(new Set());
  const [many, setMany] = useState(input.initial.size > 1);
  const [paidText, setPaidText] = useState<Record<MemberId, string>>(() =>
    Object.fromEntries(
      [...input.initial].map(([id, paid]) => [
        id,
        formatMinorInput(paid, currency as CurrencyCode),
      ]),
    ),
  );
  const effective = payers.size <= 1 ? new Set<MemberId>() : locked;

  const run = (plan: PayerPlan | null): void => {
    if (!plan) return;
    const typed = plan.typed;
    const keep = plan.selected.length <= 1 ? new Set<MemberId>() : plan.locked;
    const next = rebalancePayers({
      amount,
      selected: plan.selected,
      current: plan.current,
      locked: keep,
      seed,
    });
    setPayers(next);
    setLocked(keep);
    setPaidText(
      Object.fromEntries(
        [...next].map(([id, paid]) => [
          id,
          typed && typed.member === id
            ? typed.text
            : formatMinorInput(paid, currency as CurrencyCode),
        ]),
      ),
    );
  };

  return {
    payers,
    paidText,
    many: many || payers.size > 1,
    problem: validatePayers(amount, new Map(payers)),
    toggle: (memberId: MemberId) =>
      run(
        planToggle({ many: many || payers.size > 1, payers, locked: effective, amount, memberId }),
      ),
    entry: (memberId: MemberId, text: string) =>
      run(
        planTypedAmount({
          payers,
          locked: effective,
          memberId,
          text,
          currency: currency as CurrencyCode,
        }),
      ),
    evenly: () => run(planEvenly(payers)),
    setManyPayers: (next: boolean) => {
      if (next || payers.size <= 1) return setMany(next);
      // Back to one keeps whoever put in the most.
      setMany(false);
      run(planCollapseToOne({ payers, amount }));
    },
  };
}
