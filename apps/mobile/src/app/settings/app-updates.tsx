import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  Button,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { describeUpdate } from '@/lib/otaStatus';
import { loadUpdates } from '@/lib/restart';

type Phase = 'idle' | 'checking' | 'downloading' | 'upToDate' | 'ready' | 'failed';

/**
 * Is this phone running the JavaScript it shipped with, or an over-the-air
 * update — and a button to look for a newer one.
 *
 * `loadUpdates()` is null on web and in binaries built before expo-updates, and
 * `isEnabled` is false in development and Expo Go; in both the screen says so
 * and offers no button, rather than a check that can only fail.
 */
export default function AppUpdatesScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const [phase, setPhase] = useState<Phase>('idle');

  const updates = loadUpdates();
  const enabled = updates?.isEnabled === true;
  const busy = phase === 'checking' || phase === 'downloading';

  const check = async () => {
    if (!updates?.checkForUpdateAsync || !updates.fetchUpdateAsync) return;
    try {
      setPhase('checking');
      const { isAvailable } = await updates.checkForUpdateAsync();
      if (!isAvailable) return setPhase('upToDate');
      setPhase('downloading');
      const { isNew } = await updates.fetchUpdateAsync();
      setPhase(isNew ? 'ready' : 'upToDate');
    } catch {
      setPhase('failed');
    }
  };

  const status = {
    idle: null,
    checking: t.otaUpdates.checking,
    downloading: t.otaUpdates.downloading,
    upToDate: t.otaUpdates.upToDate,
    ready: t.otaUpdates.ready,
    failed: t.otaUpdates.failed,
  }[phase];

  const details: [string, string][] = enabled
    ? [
        [
          t.otaUpdates.running,
          describeUpdate(
            {
              embedded: updates?.isEmbeddedLaunch !== false,
              updateId: updates?.updateId ?? null,
              createdAt: updates?.createdAt ?? null,
            },
            { builtIn: t.otaUpdates.builtIn, overTheAir: t.otaUpdates.overTheAir },
          ),
        ],
        [t.otaUpdates.channel, updates?.channel || '—'],
        [t.otaUpdates.runtime, updates?.runtimeVersion || '—'],
      ]
    : [];

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
          <Text variant="heading">{t.otaUpdates.row}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          paddingTop: theme.spacing.lg,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="body" tone="muted">
          {enabled ? t.otaUpdates.intro : t.otaUpdates.unavailable}
        </Text>

        {enabled ? (
          <Card style={{ paddingVertical: theme.spacing.xs }}>
            {details.map(([label, value], index) => (
              <Row
                key={label}
                style={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: theme.spacing.md,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: theme.color.border,
                  gap: theme.spacing.md,
                }}
              >
                <Text variant="body">{label}</Text>
                <Text variant="caption" tone="muted" selectable style={{ flexShrink: 1 }}>
                  {value}
                </Text>
              </Row>
            ))}
          </Card>
        ) : null}

        {status ? (
          <Text variant="body" tone={phase === 'failed' ? 'negative' : 'muted'}>
            {status}
          </Text>
        ) : null}

        {enabled ? (
          phase === 'ready' ? (
            <Button label={t.otaUpdates.restart} onPress={() => void updates?.reloadAsync()} />
          ) : (
            <Button
              label={t.otaUpdates.check}
              variant="secondary"
              onPress={() => void check()}
              disabled={busy}
            />
          )
        ) : null}
      </ScrollView>
    </Screen>
  );
}
