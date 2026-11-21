/** "Put money aside" / "Take out": an amount, who, and the date. Who defaults to me. */

import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { CurrencyCode } from '@waves/core';
import { AmountField, Button, Row, Sheet, Text, useTheme } from '@waves/ui';

import { DateField } from '@/components/goals/DateField';
import { goalAmount } from '@/components/goals/goalText';
import { displayName, type MemberRow } from '@/data/types';
import { useStrings } from '@/i18n';
import { isoDate, showDate } from '@/lib/expenseDay';

export function ContributionSheet({
  visible,
  mode,
  currency,
  members,
  defaultMemberId,
  total,
  busy,
  onSave,
  onClose,
}: {
  visible: boolean;
  mode: 'aside' | 'out';
  currency: CurrencyCode;
  members: readonly MemberRow[];
  defaultMemberId: string | null;
  /** What is put aside now; a withdrawal cannot exceed it. */
  total: bigint;
  busy: boolean;
  onSave: (input: { memberId: string; amountMinor: bigint; date: string }) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const g = t.groupGoals;
  const [amount, setAmount] = useState<bigint>(0n);
  const [who, setWho] = useState<string | null>(defaultMemberId);
  const [date, setDate] = useState(() => isoDate(new Date()));
  const memberId = who ?? defaultMemberId ?? members[0]?.id ?? null;
  const tooMuch = mode === 'out' && amount > total;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={mode === 'aside' ? g.asideTitle : g.takeTitle}
      closeLabel={t.common.close}
    >
      <View style={{ gap: theme.spacing.md }}>
        <View>
          <Text variant="caption" tone="muted">
            {g.amountLabel}
          </Text>
          <AmountField currency={currency} value={amount} onChange={setAmount} autoFocus />
          {tooMuch ? (
            <Text variant="caption" tone="negative">
              {g.tooMuch} ({goalAmount(total, currency, locale)})
            </Text>
          ) : null}
        </View>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="caption" tone="muted">
            {g.whoLabel}
          </Text>
          <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {members.map((member) => {
              const selected = member.id === memberId;
              return (
                <Pressable
                  key={member.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setWho(member.id)}
                  style={{
                    minHeight: 40,
                    justifyContent: 'center',
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.md,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? theme.color.brand : theme.color.border,
                    backgroundColor: selected ? theme.color.brandSoft : 'transparent',
                  }}
                >
                  <Text variant="body" style={{ fontWeight: selected ? '700' : '400' }}>
                    {displayName(member, null, null, t.misc.someone)}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </View>
        <View>
          <Text variant="caption" tone="muted">
            {g.dateLabel}
          </Text>
          <DateField
            text={showDate(date, locale)}
            value={date}
            label={g.dateLabel}
            onChange={setDate}
          />
        </View>
        <Button
          label={g.save}
          disabled={busy || amount <= 0n || tooMuch || memberId === null}
          onPress={() =>
            memberId && onSave({ memberId, amountMinor: mode === 'out' ? -amount : amount, date })
          }
        />
      </View>
    </Sheet>
  );
}
