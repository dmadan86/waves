import { useEffect } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { format, money, type CurrencyCode } from '@waves/core';
import { iconSize, Text, tintForKey, useTheme } from '@waves/ui';

import { useOwedByGroup } from '@/data/hooks';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import type { OwedDirection } from '@/lib/owedByGroup';

import { GroupMark } from './GroupMark';

export function OwedCard({
  profileId,
  direction,
  onLoadingChange,
}: {
  profileId: string | null;
  direction: OwedDirection;
  onLoadingChange: (loading: boolean) => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const result = useOwedByGroup(profileId, direction);
  useEffect(() => onLoadingChange(result.isLoading), [result.isLoading, onLoadingChange]);
  // The voice stage owns the same loading indicator as a group answer.
  if (result.isLoading) return null;
  const { rows, totals } = result.data;
  const owed = direction === 'owed';
  if (!rows.length) return <Text>{owed ? t.voice.nobodyOwes : t.voice.youOweNobody}</Text>;

  const amount = (value: bigint, currency: string) =>
    format(money(value, currency as CurrencyCode), { locale });
  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.sm,
  };
  const square = {
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.brandSoft,
  };

  return (
    <View
      style={{
        alignSelf: 'stretch',
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border,
        overflow: 'hidden',
      }}
    >
      <View style={{ ...rowStyle, padding: theme.spacing.md, flexWrap: 'wrap' }}>
        <View style={square}>
          <Ionicons name="document-text-outline" size={iconSize.md} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="subheading">{owed ? t.voice.owedTitle : t.voice.oweTitle}</Text>
          <Text variant="caption" tone="muted">
            {t.voice.owedSubtitle}
          </Text>
        </View>
        <View style={{ ...square, borderRadius: theme.radius.pill }}>
          <Text variant="micro" style={{ color: theme.color.brand }}>
            {t.voice.aiResult}
          </Text>
        </View>
      </View>
      {rows.map((row) => {
        const tint = theme.tint[tintForKey(row.groupId)];
        const personTemplate =
          row.people.length === 1
            ? owed
              ? t.voice.owesYou
              : t.voice.youOweName
            : owed
              ? t.voice.owesAmount
              : t.voice.youOweAmount;
        const lines = row.people.map((person) =>
          fill(personTemplate, {
            name: person.name,
            amount: amount(person.amount, row.currency),
          }),
        );
        const total = amount(row.total, row.currency);
        return (
          <Pressable
            key={JSON.stringify([row.groupId, row.currency])}
            accessibilityRole="button"
            accessibilityLabel={`${row.groupName}, ${lines.join(', ')}, ${total}`}
            onPress={() => router.push({ pathname: '/group/[id]', params: { id: row.groupId } })}
            style={({ pressed }) => ({
              ...rowStyle,
              padding: theme.spacing.md,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View style={{ ...square, backgroundColor: tint.bg }}>
              <GroupMark emoji={row.coverEmoji} size={iconSize.lg} color={tint.ink} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="subheading" style={{ fontWeight: '700' }}>
                {row.groupName}
              </Text>
              {lines.map((line, index) => (
                <Text key={index} variant="caption" tone="muted">
                  {line}
                </Text>
              ))}
            </View>
            <View style={{ flexShrink: 1 }}>
              <Text
                variant="subheading"
                style={{ color: theme.color.brand, textAlign: 'right', fontWeight: '700' }}
              >
                {total}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={iconSize.sm} color={theme.color.brand} />
          </Pressable>
        );
      })}
      <View
        style={{
          ...rowStyle,
          padding: theme.spacing.md,
          backgroundColor: theme.color.brandSoft,
          flexWrap: 'wrap',
        }}
      >
        <Ionicons name="wallet-outline" size={iconSize.md} color={theme.color.brand} />
        <Text style={{ flex: 1 }}>{owed ? t.voice.owedTotal : t.voice.oweTotal}</Text>
        <View style={{ alignItems: 'flex-end' }}>
          {totals.map((total) => (
            <Text
              key={total.currency}
              variant="title"
              style={{ color: theme.color.brand, fontWeight: '700' }}
            >
              {amount(total.total, total.currency)}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}
