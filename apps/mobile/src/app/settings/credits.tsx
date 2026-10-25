import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Button,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';
import { SettingsSection } from '@/components/SettingsSection';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { readCredits } from '@/lib/adCredits';
import { creditButtonKey } from '@/lib/adCreditsPure';
import { watchCreditAd } from '@/lib/watchCreditAd';
import { useEntitlement } from '@/lib/useEntitlement';
import { router } from '@/lib/navigation';
export default function CreditsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const viewerId = useViewerId();
  const { isPaid } = useEntitlement();
  const wallet = useQuery({
    queryKey: ['credits', viewerId],
    queryFn: readCredits,
    enabled: !!viewerId,
    refetchInterval: 30000,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const s = wallet.data;
  const watch = async () => {
    if (busy || !viewerId || isPaid || !s?.canWatch) return;
    setBusy(true);
    try {
      const result = await watchCreditAd(viewerId, 'voluntary', 'credit_voluntary');
      setMessage(
        result === 'credited'
          ? fill(t.credits.balance, { n: (await readCredits())?.credits ?? s.credits })
          : result === 'pending'
            ? t.rewardedAds.pending
            : t.rewardedAds.error,
      );
      await wallet.refetch();
    } finally {
      setBusy(false);
    }
  };
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
          <Text variant="heading">{t.credits.title}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.xl,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
      >
        {s && !isPaid ? (
          <>
            <Text variant="title">{fill(t.credits.balance, { n: s.credits })}</Text>
            <SettingsSection
              title={t.credits.title}
              rows={(['voice', 'scan', 'export', 'group'] as const).map((kind) => ({
                icon: 'wallet-outline',
                label: t.credits[kind],
                value: fill(t.credits.price, { n: s.costs[kind] }),
              }))}
            />
            <Text variant="caption" tone="muted">
              {t.credits.earn}
            </Text>
            <Button
              label={
                s.canWatch ? fill(t.credits.watch, { n: s.perAd }) : t.credits[creditButtonKey(s)]
              }
              disabled={busy || !s.canWatch}
              onPress={() => void watch()}
            />
            {!s.canWatch && s.nextAt && (
              <Text variant="caption" tone="muted">
                {new Date(s.nextAt).toLocaleString()}
              </Text>
            )}
            {!!message && <Text variant="caption">{message}</Text>}
          </>
        ) : (
          <Text variant="caption" tone="muted">
            {t.credits.unavailable}
          </Text>
        )}
        <Button
          label={t.adGates.proLink}
          variant="ghost"
          onPress={() => router.push('/settings/upgrade')}
        />
      </ScrollView>
    </Screen>
  );
}
