/**
 * Security: the hub for what keeps this phone and this account private.
 *
 * One app lock protects Waves; the delay controls when it asks again after you
 * leave the app. Everything else here is a door to the screen that already
 * edits it — a row appears only when the thing it shows exists (no password or
 * two-factor row: the app signs in with a code or Google, and has neither).
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import {
  Badge,
  directionalIcon,
  iconSize,
  Row,
  Sheet,
  Text,
  Toggle,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import {
  ListRow,
  RowTile,
  ScenicBody,
  ScenicHeader,
  SectionHeader,
  StandardCard,
} from '@/components/standard';
import { fetchDevices } from '@/data/api';
import { useStrings } from '@/i18n';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { useAuth } from '@/lib/auth';
import { loadBackupSettings } from '@/lib/backup/settings';
import { deviceId } from '@/lib/device';
import { describeGrace, GRACE_CHOICES, useLock } from '@/lib/lock';
import { router } from '@/lib/navigation';

import { deviceGlyph } from './devices';

export default function LockSettingsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { enabled, supported, graceSeconds, setEnabled, setGraceSeconds } = useLock();
  const { session } = useAuth();
  const { hidden: amountsHidden, toggle: toggleAmounts } = usePersonalAmountsHidden();
  const [graceOpen, setGraceOpen] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);

  const user = session?.user;
  const ownerId = user?.id ?? '';
  const email = user?.email || null;
  const phone = user?.phone ? `+${user.phone.replace(/^\+/, '')}` : null;

  // The newest other live session, beside this one. Null until the list loads.
  const [myDeviceId, setMyDeviceId] = useState<string | null>(null);
  useEffect(() => {
    void deviceId().then(setMyDeviceId);
  }, []);
  const devices = useQuery({ queryKey: ['devices'], queryFn: fetchDevices });
  const rows = myDeviceId ? (devices.data ?? []) : [];
  const mine = rows.find((row) => row.deviceId === myDeviceId);
  const other = rows.find((row) => row.deviceId !== myDeviceId && !row.revokedAt);

  // Only ever says "last backed up" for a backup that really landed.
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  // Re-read on every return, so a backup made on the Backup screen shows here.
  useFocusEffect(
    useCallback(() => {
      if (!ownerId) return;
      let alive = true;
      void loadBackupSettings(ownerId)
        .then((settings) => alive && setLastBackup(settings.last?.at ?? null))
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, [ownerId]),
  );

  const day = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  const tile = (
    name: keyof typeof Ionicons.glyphMap,
    tint = theme.color.brandSoft,
    ink?: string,
  ) => (
    <RowTile tint={tint}>
      <Ionicons name={name} size={iconSize.lg} color={ink ?? theme.color.brand} />
    </RowTile>
  );
  const chevron = (
    <Ionicons
      name={directionalIcon('chevron-forward')}
      size={iconSize.base}
      color={theme.color.textFaint}
    />
  );
  const contactRow = (
    glyph: keyof typeof Ionicons.glyphMap,
    title: string,
    value: string,
    verified: boolean,
    divider: boolean,
  ) => (
    <ListRow
      divider={divider}
      leading={tile(glyph)}
      title={title}
      subtitle={value}
      trailing={
        <Row style={{ gap: theme.spacing.sm }}>
          {verified ? (
            <Badge
              label={t.lock.verified}
              tone="positive"
              icon={(color) => (
                <Ionicons name="checkmark-circle" size={iconSize.sm} color={color} />
              )}
            />
          ) : null}
          {chevron}
        </Row>
      }
      onPress={() => router.push('/settings/account')}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader title={t.lock.title} subtitle={t.lock.subtitle} titleAlign="start" wash />
        <ScenicBody>
          <StandardCard style={{ paddingVertical: theme.spacing.sm }}>
            <ListRow
              leading={tile('finger-print-outline')}
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
              divider={!supported || enabled}
            />
            {!supported ? <Badge label={t.lock.unsupported} /> : null}
            {supported && enabled ? (
              <ListRow
                leading={tile('time-outline')}
                title={t.lock.askAgainAfter}
                subtitle={describeGrace(graceSeconds, t, locale)}
                onPress={() => setGraceOpen(true)}
              />
            ) : null}
            <Row
              style={{
                gap: theme.spacing.sm,
                paddingTop: theme.spacing.md,
                paddingHorizontal: theme.spacing.xs,
                borderTopWidth: 1,
                borderTopColor: theme.color.border,
              }}
            >
              <Ionicons name="shield-checkmark" size={iconSize.base} color={theme.color.brand} />
              <Text variant="micro" tone="muted" style={{ flex: 1 }}>
                {t.lock.footnoteShort}
              </Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setLearnOpen(true)}>
                <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
                  {t.lock.learnMore}
                </Text>
              </Pressable>
            </Row>
          </StandardCard>

          <View style={{ gap: theme.spacing.sm }}>
            <SectionHeader title={t.lock.accountTitle} />
            <Text variant="caption" tone="muted">
              {t.lock.accountSub}
            </Text>
            <StandardCard style={{ paddingVertical: theme.spacing.sm }}>
              {email
                ? contactRow(
                    'mail-outline',
                    t.lock.email,
                    email,
                    Boolean(user?.email_confirmed_at),
                    Boolean(phone),
                  )
                : null}
              {phone
                ? contactRow(
                    'phone-portrait-outline',
                    t.lock.phone,
                    phone,
                    Boolean(user?.phone_confirmed_at),
                    false,
                  )
                : null}
              {!email && !phone ? (
                <ListRow
                  leading={tile('mail-outline')}
                  title={t.lock.addContact}
                  onPress={() => router.push('/settings/account')}
                />
              ) : null}
            </StandardCard>
          </View>

          {mine || other ? (
            <View style={{ gap: theme.spacing.sm }}>
              <SectionHeader
                title={t.devices.title}
                action={{ label: t.lock.seeAll, onPress: () => router.push('/settings/devices') }}
              />
              <Text variant="caption" tone="muted">
                {t.lock.devicesSub}
              </Text>
              <StandardCard style={{ paddingVertical: theme.spacing.sm }}>
                {mine ? (
                  <ListRow
                    divider={Boolean(other)}
                    leading={tile(deviceGlyph(mine.platform))}
                    title={mine.label}
                    subtitle={mine.platform}
                    footer={
                      <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: theme.color.positive,
                          }}
                        />
                        <Text variant="caption" style={{ color: theme.color.positive }}>
                          {t.lock.activeNow}
                        </Text>
                      </Row>
                    }
                    trailing={<Badge label={t.devices.thisDevice} tone="brand" />}
                  />
                ) : null}
                {other ? (
                  <ListRow
                    leading={tile(deviceGlyph(other.platform))}
                    title={other.label}
                    subtitle={other.platform}
                    footer={
                      <Text variant="caption" tone="muted">
                        {t.devices.lastActive.replace('{when}', day(Date.parse(other.lastSeenAt)))}
                      </Text>
                    }
                    onPress={() => router.push('/settings/devices')}
                  />
                ) : null}
              </StandardCard>
            </View>
          ) : null}

          <View style={{ gap: theme.spacing.sm }}>
            <SectionHeader title={t.lock.dataTitle} />
            <Text variant="caption" tone="muted">
              {t.lock.dataSub}
            </Text>
            <StandardCard style={{ paddingVertical: theme.spacing.sm }}>
              <ListRow
                divider
                leading={tile('cloud-outline')}
                title={t.backup.title}
                subtitle={
                  lastBackup
                    ? t.lock.backupOn.replace('{date}', day(lastBackup))
                    : t.lock.backupNever
                }
                onPress={() => router.push('/settings/backup')}
              />
              <ListRow
                divider
                leading={tile('eye-off-outline')}
                title={t.lock.hideAmounts}
                subtitle={t.lock.hideAmountsHint}
                subtitleLines={2}
                trailing={
                  <Toggle
                    value={amountsHidden}
                    onValueChange={toggleAmounts}
                    accessibilityLabel={t.lock.hideAmounts}
                  />
                }
              />
              <ListRow
                destructive
                leading={tile('trash-outline', theme.color.negativeSoft, theme.color.negative)}
                title={t.lock.deleteRow}
                subtitle={t.lock.deleteHint}
                onPress={() => router.push('/settings/delete-account')}
              />
            </StandardCard>
          </View>
        </ScenicBody>
      </ScrollView>

      <Sheet visible={graceOpen} onClose={() => setGraceOpen(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="heading">{t.lock.askAgainAfter}</Text>
          <Text variant="caption" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
            {t.lock.askAgainShort}
          </Text>
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
                  trailing={
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={iconSize.lg}
                      color={selected ? theme.color.brand : theme.color.textFaint}
                    />
                  }
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
        </View>
      </Sheet>

      <Sheet visible={learnOpen} onClose={() => setLearnOpen(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t.lock.learnTitle}</Text>
          <Text>{t.lock.learnTransit}</Text>
          <Text>{t.lock.learnRest}</Text>
          <Text variant="caption" tone="muted">
            {t.lock.learnLimits}
          </Text>
        </View>
      </Sheet>
    </View>
  );
}
