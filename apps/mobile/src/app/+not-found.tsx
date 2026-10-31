/**
 * Any link the app has no screen for (an old or mistyped link) lands here
 * instead of Expo Router's developer "Unmatched Route" page.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Button, iconSize, Screen, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export default function NotFoundScreen() {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Screen>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.xxl,
          gap: theme.spacing.md,
        }}
      >
        <Ionicons name="compass-outline" size={iconSize.xl * 2} color={theme.color.brand} />
        <Text variant="heading" align="center">
          {t.lostPage.title}
        </Text>
        <Text tone="muted" align="center">
          {t.lostPage.body}
        </Text>
        <Button label={t.lostPage.action} onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
