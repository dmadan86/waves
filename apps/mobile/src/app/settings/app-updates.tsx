import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { directionalIcon, iconSize, Row, Text, useTabBarClearance, useTheme } from '@waves/ui';

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
            <UpdateArt failed={phase === 'failed'} />
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
              <ActionRow
                filled
                icon="reload"
                label={t.otaUpdates.restart}
                onPress={() => void updates?.reloadAsync()}
              />
            ) : (
              <ActionRow
                filled
                icon="sync"
                label={t.otaUpdates.check}
                disabled={busy}
                onPress={check}
              />
            )
          ) : null}
          <ActionRow
            icon="time-outline"
            label={t.pendingChanges.row}
            onPress={() => router.push('/settings/pending-changes')}
          />
        </StandardCard>
      </ScrollView>
    </View>
  );
}

/** A full-width row button: icon and label at the start, a chevron at the end. */
function ActionRow({
  icon,
  label,
  onPress,
  filled = false,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  filled?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const color = filled ? theme.color.onBrand : theme.color.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: 52,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: filled ? theme.color.brand : theme.color.brandSoft,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={color} />
      <Text variant="subheading" numberOfLines={1} style={{ flex: 1, color }}>
        {label}
      </Text>
      <Ionicons name={directionalIcon('chevron-forward')} size={iconSize.md} color={color} />
    </Pressable>
  );
}

/** The hero art: a tilted phone with a check (or alert) on a soft cloud. */
function UpdateArt({ failed }: { failed: boolean }) {
  const theme = useTheme();
  const brand = theme.color.brand;
  const mark = failed ? theme.color.negative : brand;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={112} height={96} viewBox="0 0 112 96">
        <Path
          d="M8 92 C8 80 18 74 28 76 C32 66 44 62 52 68 C60 58 80 58 86 70 C98 68 108 78 106 92 Z"
          fill={brand}
          opacity={0.14}
        />
        <G rotation={8} origin="62, 48">
          <Rect
            x={42}
            y={6}
            width={40}
            height={78}
            rx={8}
            fill={theme.color.surface}
            stroke={brand}
            strokeWidth={3}
          />
          <Rect x={56} y={12} width={12} height={2.5} rx={1.25} fill={brand} />
          <Circle cx={62} cy={45} r={11} fill={mark} opacity={0.85} />
          <Path
            d={failed ? 'M62 39 L62 46 M62 50 L62 50.5' : 'M57 45 L61 49 L67.5 41.5'}
            stroke={theme.color.onBrand}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </G>
        <Path
          d="M30 22 L35 28 M26 34 L33 35.5"
          stroke={brand}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
