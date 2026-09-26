import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { IconButton, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { SettleBody } from '@/components/settle/SettleBody';
import { useGroup } from '@/data/hooks';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export default function SettleScreen() {
  const theme = useTheme();
  const { t } = useStrings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const { group } = useGroup(groupId);

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.close} onPress={() => router.back()}>
          <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.settleUp}</Text>
          {group.data?.name ? (
            <Text variant="micro" tone="muted">
              {group.data.name}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 44 }} />
      </Row>
      <SettleBody groupId={groupId} />
    </Screen>
  );
}
