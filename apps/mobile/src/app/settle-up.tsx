/** Choose a group to settle in. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { directionalIcon, IconButton, iconSize, Screen, Text, useTheme } from '@waves/ui';

import { SettleGroupList } from '@/components/home/SettleGroupList';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { useSettleCandidates } from '@/lib/useSettleCandidates';

export default function SettleUpScreen() {
  const theme = useTheme();
  const { t } = useStrings();
  const groups = useSettleCandidates();

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
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {t.homeDash.settleSubtitle}
            </Text>
          </View>
        </View>
      </View>
      <SettleGroupList groups={groups} />
    </Screen>
  );
}
