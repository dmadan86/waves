/** Choose a group to settle in. */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TextInput, View } from 'react-native';

import { ChipRow, directionalIcon, IconButton, iconSize, Screen, Text, useTheme } from '@waves/ui';

import { SplitMoney } from '@/components/SplitMoney';
import { SettleGroupList } from '@/components/home/SettleGroupList';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import {
  filterSettleByBalance,
  filterSettleCandidates,
  type SettleFilter,
} from '@/lib/settlePicker';
import { useSettleCandidates } from '@/lib/useSettleCandidates';

export default function SettleUpScreen() {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const groups = useSettleCandidates();
  const [filter, setFilter] = useState<SettleFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const shown = useMemo(
    () => filterSettleCandidates(filterSettleByBalance(groups, filter), query),
    [groups, filter, query],
  );

  // Totals only when one currency; mixed currencies are never added together.
  const sameCurrency = groups.length > 0 && groups.every((g) => g.currency === groups[0]!.currency);
  const owedTotal = groups.reduce((n, g) => (g.balance > 0n ? n + g.balance : n), 0n);
  const oweTotal = groups.reduce((n, g) => (g.balance < 0n ? n - g.balance : n), 0n);
  const square = groups.length === 0;

  const options = [
    {
      value: 'all' as const,
      label: t.homeDash.settleAllGroups,
      icon: (c: string) => <Ionicons name="people" size={iconSize.base} color={c} />,
    },
    {
      value: 'owed' as const,
      label: t.youAreOwed,
      icon: () => <Ionicons name="arrow-up" size={iconSize.base} color={theme.color.positive} />,
    },
    {
      value: 'owe' as const,
      label: t.youOwe,
      icon: () => <Ionicons name="arrow-down" size={iconSize.base} color={theme.color.negative} />,
    },
  ];

  return (
    <Screen>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <IconButton label={t.common.back} onPress={() => router.back()}>
            <Ionicons
              name={directionalIcon('chevron-back')}
              size={iconSize.lg}
              color={theme.color.text}
            />
          </IconButton>
          <View style={{ flex: 1 }}>
            <Text variant="title">{t.homeDash.settleTitle}</Text>
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {t.homeDash.settleSubtitle}
            </Text>
          </View>
          <IconButton
            label={searchOpen ? t.common.close : t.searchGroups}
            repeatable
            onPress={() => {
              // A hidden filter still narrowing the list would read as groups gone.
              if (searchOpen) setQuery('');
              setSearchOpen(!searchOpen);
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Ionicons
                name={searchOpen ? 'close' : 'search'}
                size={iconSize.lg}
                color={theme.color.brand}
              />
            </View>
          </IconButton>
        </View>
      </View>

      {searchOpen ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            marginHorizontal: theme.spacing.lg,
            marginBottom: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            height: 40,
            borderRadius: theme.radius.md,
            backgroundColor: theme.color.surfaceMuted,
          }}
        >
          <Ionicons name="search" size={iconSize.base} color={theme.color.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            accessibilityLabel={t.searchGroups}
            placeholder={t.searchGroups}
            placeholderTextColor={theme.color.textFaint}
            autoFocus
            style={{
              flex: 1,
              fontSize: theme.typography.body.fontSize,
              color: theme.color.text,
              padding: 0,
              textAlign: 'auto',
            }}
          />
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          marginHorizontal: theme.spacing.lg,
          marginBottom: theme.spacing.sm,
          padding: theme.spacing.md,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: square ? theme.color.positive : theme.color.surface,
          }}
        >
          <Ionicons
            name={square ? 'checkmark' : 'swap-vertical'}
            size={iconSize.lg}
            color={square ? theme.color.onBrand : theme.color.brand}
          />
        </View>
        <View style={{ flex: 1 }}>
          {square ? (
            <>
              <Text style={{ fontWeight: '700' }}>{t.homeDash.settleEmpty}</Text>
              <Text variant="caption" tone="muted">
                {t.homeDash.settleSquareBody}
              </Text>
            </>
          ) : sameCurrency ? (
            <>
              {[
                { label: t.youAreOwed, amount: owedTotal, color: theme.color.positive },
                { label: t.youOwe, amount: oweTotal, color: theme.color.negative },
              ]
                .filter((x) => x.amount > 0n)
                .map((x) => (
                  <View
                    key={x.label}
                    style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                  >
                    <Text variant="caption" tone="muted">
                      {x.label}
                    </Text>
                    <SplitMoney
                      amount={x.amount}
                      currency={groups[0]!.currency}
                      locale={locale}
                      color={x.color}
                      fontSize={16}
                    />
                  </View>
                ))}
            </>
          ) : (
            <Text style={{ fontWeight: '700' }}>
              {t.homeDash.acrossGroups.other.replace('{n}', String(groups.length))}
            </Text>
          )}
        </View>
      </View>

      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <ChipRow options={options} value={filter} onChange={setFilter} variant="brand" onCard />
      </View>
      <SettleGroupList groups={shown} narrowed={groups.length > 0 && shown.length === 0} />
    </Screen>
  );
}
