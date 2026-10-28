/** Choose a group to settle in. */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TextInput, View } from 'react-native';

import { ChipRow, directionalIcon, IconButton, iconSize, Screen, Text, useTheme } from '@waves/ui';

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
  const { t } = useStrings();
  const groups = useSettleCandidates();
  const [filter, setFilter] = useState<SettleFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const shown = useMemo(
    () => filterSettleCandidates(filterSettleByBalance(groups, filter), query),
    [groups, filter, query],
  );

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
            borderRadius: theme.radius.pill,
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

      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <ChipRow options={options} value={filter} onChange={setFilter} variant="brand" onCard />
      </View>
      <SettleGroupList groups={shown} narrowed={groups.length > 0 && shown.length === 0} />
    </Screen>
  );
}
