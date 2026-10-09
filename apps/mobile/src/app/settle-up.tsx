/**
 * Settle up, as a screen: which group to settle in, the groups where you owe or
 * are owed, largest first. Home's and Friends' Settle up buttons open it. It
 * used to be a bottom sheet; a screen gives a long list the full height and a
 * real back gesture.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import {
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useScreenClearance,
  useTheme,
} from '@waves/ui';

import { SettleGroupList } from '@/components/home/SettleGroupList';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { useSettleCandidates } from '@/lib/useSettleCandidates';

export default function SettleUpScreen() {
  const theme = useTheme();
  const { t } = useStrings();
  const clearance = useScreenClearance();
  const groups = useSettleCandidates();

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.homeDash.settleTitle}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>
      <View
        style={{
          flex: 1,
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          paddingBottom: clearance,
        }}
      >
        <SettleGroupList groups={groups} />
      </View>
    </Screen>
  );
}
