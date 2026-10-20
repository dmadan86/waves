/**
 * Where a "{who} says you are {name} in {group}" push lands: the same card
 * Home shows, on a page of its own, so the tap goes straight to the question.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';

import { directionalIcon, IconButton, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { LinkRequestsCard } from '@/components/LinkRequestsCard';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

export default function LinkRequestsScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const { session } = useAuth();

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="heading" numberOfLines={1}>
            {t.link.cardTitle}
          </Text>
        </View>
      </Row>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: clearance }}
      >
        <LinkRequestsCard enabled={session !== null} showEmpty />
      </ScrollView>
    </Screen>
  );
}
