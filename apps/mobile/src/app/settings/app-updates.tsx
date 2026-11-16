import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, iconSize, Row, Text, useTabBarClearance, useTheme } from '@waves/ui';

import { ListRow, PlainHeader, RowTile, SectionHeader, StandardCard } from '@/components/standard';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { describeUpdate } from '@/lib/otaStatus';
import { loadUpdates } from '@/lib/restart';

type Phase = 'idle' | 'checking' | 'downloading' | 'upToDate' | 'ready' | 'failed';

/**
 * Is this phone running the JavaScript it shipped with, or an over-the-air
 * update — and a button to look for a newer one. It checks once on open, so the
 * card can say "You're up to date" instead of asking the question back.
 *
 * `loadUpdates()` is null on web and in binaries built before expo-updates, and
 * `isEnabled` is false in development and Expo Go; in both the screen says so
 * and offers no button, rather than a check that can only fail.
 */
export default function AppUpdatesScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const updates = loadUpdates();
  const enabled = updates?.isEnabled === true;
  const canCheck = enabled && !!updates?.checkForUpdateAsync && !!updates.fetchUpdateAsync;
  const [phase, setPhase] = useState<Phase>(canCheck ? 'checking' : 'idle');
  const busy = phase === 'checking' || phase === 'downloading';

  // Starts in 'checking' (set by the caller), so the on-open check sets no state before its first await.
  const look = async () => {
    if (!updates?.checkForUpdateAsync || !updates.fetchUpdateAsync) return;
    try {
      const { isAvailable } = await updates.checkForUpdateAsync();
      if (!isAvailable) return setPhase('upToDate');
      setPhase('downloading');
      const { isNew } = await updates.fetchUpdateAsync();
      setPhase(isNew ? 'ready' : 'upToDate');
    } catch {
      setPhase('failed');
    }
  };

  const check = () => {
    setPhase('checking');
    void look();
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state changes only after the network await
    if (canCheck) void look();
    // Once per visit; the button repeats it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = !enabled
    ? t.otaUpdates.row
    : {
        idle: t.otaUpdates.row,
        checking: t.otaUpdates.checking,
        downloading: t.otaUpdates.downloading,
        upToDate: t.otaUpdates.upToDateTitle,
        ready: t.otaUpdates.ready,
        failed: t.otaUpdates.failed,
      }[phase];

  const details: [keyof typeof Ionicons.glyphMap, string, string][] = enabled
    ? [
        [
          'cube-outline',
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
        ['layers-outline', t.otaUpdates.channel, updates?.channel || '—'],
        ['information-circle-outline', t.otaUpdates.runtime, updates?.runtimeVersion || '—'],
      ]
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <PlainHeader title={t.otaUpdates.row} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <StandardCard style={{ backgroundColor: theme.color.brandSoft, borderWidth: 0 }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View style={{ flex: 1, gap: theme.spacing.sm }}>
              <Text
                variant="heading"
                accessibilityLiveRegion="polite"
                style={{
                  fontWeight: '800',
                  color: phase === 'failed' ? theme.color.negative : theme.color.text,
                }}
              >
                {title}
              </Text>
              <Text variant="body" tone="muted">
                {enabled ? t.otaUpdates.intro : t.otaUpdates.unavailable}
              </Text>
              {phase === 'upToDate' ? (
                <Row
                  style={{
                    alignSelf: 'flex-start',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: theme.color.positiveSoft,
                  }}
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={iconSize.md}
                    color={theme.color.positive}
                  />
                  <Text
                    variant="caption"
                    style={{ color: theme.color.positive, fontWeight: '600' }}
                  >
                    {t.otaUpdates.latest}
                  </Text>
                </Row>
              ) : null}
            </View>
            {/* shortcut: an icon stands in for the mockup's illustration; swap for art when there is some. */}
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Ionicons name="phone-portrait-outline" size={72} color={theme.color.brand} />
              <Ionicons
                name={phase === 'failed' ? 'alert-circle' : 'checkmark-circle'}
                size={28}
                color={phase === 'failed' ? theme.color.negative : theme.color.brand}
                style={{ position: 'absolute', top: 22, left: 22 }}
              />
            </View>
          </Row>
        </StandardCard>

        {enabled ? (
          <View style={{ gap: theme.spacing.sm }}>
            <SectionHeader title={t.otaUpdates.current} />
            <StandardCard style={{ paddingVertical: theme.spacing.sm }}>
              {details.map(([icon, label, value], index) => (
                <ListRow
                  key={label}
                  leading={
                    <RowTile tint={theme.color.brandSoft}>
                      <Ionicons name={icon} size={iconSize.lg} color={theme.color.brand} />
                    </RowTile>
                  }
                  title={label}
                  divider={index < details.length - 1}
                  trailing={
                    <Text variant="caption" tone="muted" selectable>
                      {value}
                    </Text>
                  }
                  accessibilityRole="text"
                />
              ))}
            </StandardCard>
          </View>
        ) : null}

        <StandardCard style={{ gap: theme.spacing.sm }}>
          {canCheck ? (
            phase === 'ready' ? (
              <Button
                label={t.otaUpdates.restart}
                variant="brand"
                fullWidth
                icon={<Ionicons name="reload" size={iconSize.md} color={theme.color.onBrand} />}
                onPress={() => void updates?.reloadAsync()}
              />
            ) : (
              <Button
                label={t.otaUpdates.check}
                variant="brand"
                fullWidth
                disabled={busy}
                icon={<Ionicons name="sync" size={iconSize.md} color={theme.color.onBrand} />}
                onPress={check}
              />
            )
          ) : null}
          <Button
            label={t.pendingChanges.row}
            variant="secondary"
            fullWidth
            icon={<Ionicons name="time-outline" size={iconSize.md} color={theme.color.brand} />}
            onPress={() => router.push('/settings/pending-changes')}
          />
        </StandardCard>
      </ScrollView>
    </View>
  );
}
