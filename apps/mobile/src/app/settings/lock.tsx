/**
 * Security.
 *
 * One app lock protects Waves; the delay controls when it asks again
 * after you leave the app.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';

import { Badge, iconSize, Row, Text, Toggle, useTabBarClearance, useTheme } from '@waves/ui';

import { ListRow, PlainHeader, RowTile, SectionHeader, StandardCard } from '@/components/standard';
import { useStrings } from '@/i18n';
import { describeGrace, GRACE_CHOICES, useLock } from '@/lib/lock';

export default function LockSettingsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { enabled, supported, graceSeconds, setEnabled, setGraceSeconds } = useLock();

  const radio = (on: boolean) => (
    <Ionicons
      name={on ? 'radio-button-on' : 'radio-button-off'}
      size={iconSize.lg}
      color={on ? theme.color.brand : theme.color.textFaint}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <PlainHeader title={t.lock.title} />
      <Text
        variant="caption"
        tone="muted"
        style={{ paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.sm }}
      >
        {t.lock.subtitle}
      </Text>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <StandardCard style={{ paddingVertical: theme.spacing.sm }}>
          <ListRow
            leading={
              <RowTile tint={theme.color.brandSoft}>
                <Ionicons
                  name="finger-print-outline"
                  size={iconSize.lg}
                  color={theme.color.brand}
                />
              </RowTile>
            }
            title={t.lock.requireShort}
            subtitle={t.lock.requireHint}
            titleLines={2}
            subtitleLines={3}
            trailing={
              <Toggle
                value={enabled}
                disabled={!supported}
                onValueChange={(value) => void setEnabled(value)}
                accessibilityLabel={t.lock.appLock}
              />
            }
          />
          {!supported ? <Badge label={t.lock.unsupported} /> : null}
        </StandardCard>

        {supported && enabled ? (
          <StandardCard style={{ paddingVertical: theme.spacing.sm, gap: theme.spacing.xs }}>
            <Row style={{ gap: theme.spacing.md, paddingVertical: theme.spacing.xs }}>
              <RowTile tint={theme.color.brandSoft}>
                <Ionicons name="time-outline" size={iconSize.lg} color={theme.color.brand} />
              </RowTile>
              <View style={{ flex: 1 }}>
                <SectionHeader title={t.lock.askAgainAfter} />
                <Text variant="caption" tone="muted">
                  {t.lock.askAgainShort}
                </Text>
              </View>
            </Row>
            {GRACE_CHOICES.map((seconds) => {
              const selected = graceSeconds === seconds;
              return (
                <View
                  key={seconds}
                  style={{
                    borderRadius: theme.radius.lg,
                    borderWidth: 1.5,
                    borderColor: selected ? theme.color.brand : 'transparent',
                    backgroundColor: selected ? theme.color.brandSoft : undefined,
                    paddingHorizontal: theme.spacing.md,
                  }}
                >
                  <ListRow
                    compact
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    title={describeGrace(seconds, t, locale)}
                    trailing={radio(selected)}
                    onPress={() => void setGraceSeconds(seconds)}
                    // Picking a value, not opening anything: every tap counts.
                    repeatable
                  />
                </View>
              );
            })}
            <Text variant="micro" tone="muted" style={{ marginTop: theme.spacing.xs }}>
              {t.lock.reopenShort}
            </Text>
          </StandardCard>
        ) : null}

        <Row style={{ justifyContent: 'center', gap: theme.spacing.xs }}>
          <Ionicons
            name="shield-checkmark-outline"
            size={iconSize.sm}
            color={theme.color.textMuted}
          />
          <Text variant="micro" tone="muted" align="center" style={{ flexShrink: 1 }}>
            {t.lock.footnoteShort}
          </Text>
        </Row>
      </ScrollView>
    </View>
  );
}
