/**
 * Who paid, inside the expense's quick-edit sheet — one person or several,
 * without leaving the sheet.
 *
 * The sheet used to be a plain radio list: tap a name, that person paid it all.
 * Anybody whose bill was "she got the taxi, I got the tickets" had no way to say
 * so here, and nothing on the sheet hinted that the full editor could — you had
 * to already know. So the second payer is offered where the eye already is: a
 * "+" at the end of every row that is not paying, which adds that person as a
 * co-payer and splits the paying evenly on the spot. The header link that
 * switches modes carries the same words the full editor uses, so the two
 * surfaces teach one vocabulary.
 *
 * One payer stays exactly one tap on a name. Figures appear only once a second
 * person is on the bill, and they follow the full editor's rules through the
 * same pure plans (`expenseForm`): typing a figure fixes it, the others absorb
 * the difference, and "Split evenly" drops every fixed figure.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';

import {
  currencySymbol,
  format,
  formatMinorInput,
  money,
  rebalancePayers,
  type CurrencyCode,
  type MemberId,
  type PayerMap,
} from '@waves/core';
import { amountKeyboard, Avatar, iconSize, Row, Text, useTheme } from '@waves/ui';

import { displayName, isGhost, type MemberRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import {
  planCollapseToOne,
  planEvenly,
  planToggle,
  planTypedAmount,
  type PayerPlan,
} from '@/lib/expenseForm';

const NO_LOCKS: ReadonlySet<MemberId> = new Set<MemberId>();
const LINK_HIT_SLOP = { top: 12, bottom: 12, left: 8, right: 8 } as const;

export function PayerChooser({
  members,
  viewerId,
  payers,
  amount,
  currency,
  seed,
  onChange,
}: {
  members: readonly MemberRow[];
  viewerId: string | null | undefined;
  payers: PayerMap;
  amount: bigint;
  currency: string;
  /** The expense id, so which payer absorbs an odd paisa is stable (ADR-009). */
  seed: string;
  onChange: (next: PayerMap) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const code = currency as CurrencyCode;
  // A bill that already records several payers opens in several-payer mode:
  // an edit must never offer to quietly drop one of them.
  const [many, setMany] = useState(payers.size > 1);
  const [locked, setLocked] = useState<ReadonlySet<MemberId>>(NO_LOCKS);
  const [paidText, setPaidText] = useState<Record<MemberId, string>>(() => textFor(payers, code));

  const effectiveLocks = payers.size <= 1 ? NO_LOCKS : locked;

  const run = (plan: PayerPlan | null): void => {
    if (!plan) return;
    const effective = plan.selected.length <= 1 ? NO_LOCKS : plan.locked;
    const next = rebalancePayers({
      amount,
      selected: plan.selected,
      current: plan.current,
      locked: effective,
      seed,
    });
    setLocked(effective);
    setPaidText(textFor(next, code, plan.typed));
    onChange(next);
  };

  /** The "+" on a row: this person paid some of it too. */
  const addCoPayer = (memberId: MemberId): void => {
    setMany(true);
    run(planToggle({ many: true, payers, locked: effectiveLocks, amount, memberId }));
  };

  const toggleMode = (): void => {
    if (many) {
      // Back to one: whoever put in the most keeps the bill. Nothing is saved
      // until Save, so Cancel is the undo — no confirmation needed here.
      setMany(false);
      run(planCollapseToOne({ payers, amount }));
    } else {
      setMany(true);
    }
  };

  const nameOf = (member: MemberRow): string => displayName(member, viewerId);

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Row style={{ justifyContent: 'flex-end', gap: theme.spacing.lg }}>
        {many && payers.size > 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.expense.splitPaidEvenly}
            onPress={() => run(planEvenly(payers))}
            hitSlop={LINK_HIT_SLOP}
          >
            <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
              {t.expense.splitPaidEvenly}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: many }}
          accessibilityLabel={many ? t.expense.paidByOne : t.expense.paidBySeveral}
          onPress={toggleMode}
          hitSlop={LINK_HIT_SLOP}
        >
          <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
            {many ? t.expense.paidByOne : t.expense.paidBySeveral}
          </Text>
        </Pressable>
      </Row>

      {members.map((member) => {
        const isPayer = payers.has(member.id);
        const name = nameOf(member);
        return (
          <Row key={member.id} style={{ gap: theme.spacing.md, alignItems: 'center' }}>
            <Pressable
              // One payer is a radio (a tap replaces); several is a checkbox (a
              // tap adds or removes). The role follows the gesture.
              accessibilityRole={many ? 'checkbox' : 'radio'}
              accessibilityState={many ? { checked: isPayer } : { selected: isPayer }}
              accessibilityLabel={`${t.paidBy}: ${name}`}
              onPress={() =>
                run(
                  planToggle({ many, payers, locked: effectiveLocks, amount, memberId: member.id }),
                )
              }
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 0,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.md,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Avatar name={displayName(member)} ghost={isGhost(member)} size={32} />
              <Text
                variant="body"
                numberOfLines={1}
                style={{ flex: 1, color: isPayer ? theme.color.brand : theme.color.text }}
              >
                {name}
              </Text>
              {!many && isPayer ? (
                <Ionicons name="checkmark" size={iconSize.md} color={theme.color.brand} />
              ) : null}
            </Pressable>

            {many && isPayer && payers.size > 1 ? (
              <Row style={{ gap: theme.spacing.xs, alignItems: 'center', width: 120 }}>
                <Text variant="caption" tone="muted">
                  {currencySymbol(code)}
                </Text>
                <TextInput
                  value={paidText[member.id] ?? ''}
                  onChangeText={(text) =>
                    run(
                      planTypedAmount({
                        payers,
                        locked: effectiveLocks,
                        memberId: member.id,
                        text,
                        currency: code,
                      }),
                    )
                  }
                  keyboardType={amountKeyboard(code)}
                  selectTextOnFocus
                  placeholder="0"
                  placeholderTextColor={theme.color.textFaint}
                  accessibilityLabel={fill(t.expense.paidByNameAmount, {
                    name,
                    amount: format(money(payers.get(member.id) ?? 0n, code), { locale }),
                  })}
                  style={{
                    flex: 1,
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
            ) : !isPayer ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={fill(t.expense.alsoPaid, { name })}
                onPress={() => addCoPayer(member.id)}
                hitSlop={8}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.brandSoft,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name="add" size={iconSize.md} color={theme.color.brand} />
              </Pressable>
            ) : null}
          </Row>
        );
      })}
    </View>
  );
}

/** Each payer's figure as field text, keeping the characters just typed. */
function textFor(
  payers: PayerMap,
  currency: CurrencyCode,
  typed?: { readonly member: MemberId; readonly text: string },
): Record<MemberId, string> {
  const fields: Record<MemberId, string> = {};
  for (const [member, paid] of payers) {
    fields[member] =
      typed && typed.member === member ? typed.text : formatMinorInput(paid, currency);
  }
  return fields;
}
