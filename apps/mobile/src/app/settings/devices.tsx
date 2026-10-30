/**
 * Where this account is signed in, and the one button that trims it.
 *
 * The free tier is two devices at a time (see `deviceSession.tsx`); this is the
 * screen that makes that legible — the phones seen in the last three months,
 * this one marked, and "log out all other devices" for when the list has
 * somebody on it you do not recognise. Signing the others out here is the same
 * action the over-limit gate offers, reached calmly rather than because you are
 * blocked.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import {
  activeDevices,
  DEVICE_ACTIVE_WINDOW_DAYS,
  deviceLimitFor,
  FREE_DEVICE_LIMIT,
  isPaidTier,
  PRO_DEVICE_LIMIT,
  type DeviceSession,
} from '@waves/core';
import {
  Badge,
  Button,
  EmptyState,
  iconSize,
  Row,
  Screen,
  Sheet,
  Popup,
  Text,
  useTheme,
} from '@waves/ui';

import { OverflowMenu } from '@/components/OverflowMenu';
import { ScenicBody, ScenicHeader, SectionHeader, StandardCard } from '@/components/standard';
import { fetchDevices } from '@/data/api';
import { fill, plural, useStrings } from '@/i18n';
import { deviceId } from '@/lib/device';
import { useDeviceSession } from '@/lib/deviceSession';
import { friendlyError } from '@/lib/errors';
import { useBottomClearance } from '@/lib/clearance';
import { useEntitlement } from '@/lib/useEntitlement';

/** The green of a live session's dot and its "Last active" line. */
const LIVE_GREEN = '#16A34A';
const MINUTE = 60_000;

/**
 * A phone, a tablet or a computer, read off the free-text label and platform.
 * Only ever decides which glyph sits in front of a row.
 */
function deviceGlyph(row: DeviceSession) {
  const p = `${row.label} ${row.platform}`.toLowerCase();
  if (/ipad|tablet/.test(p)) return 'tablet-portrait-outline';
  const isDesktop = /web|mac|windows|linux|desktop|chrome|firefox|safari|browser|edge/.test(p);
  return isDesktop ? 'desktop-outline' : 'phone-portrait-outline';
}

const OS_NAMES: Record<string, string> = {
  android: 'Android',
  ios: 'iOS',
  ipados: 'iPadOS',
  macos: 'macOS',
  windows: 'Windows',
  web: 'Web',
};

/** "android 16" reads "Android 16"; the platform string is lowercase on the wire. */
function osLabel(platform: string): string {
  return platform.replace(/^[a-z]+/i, (os) => OS_NAMES[os.toLowerCase()] ?? os);
}

/** Relative for the last week ("2 minutes ago"), a date after that. */
function lastSeenText(
  iso: string,
  now: number,
  locale: string,
  rtf: Intl.RelativeTimeFormat | undefined,
) {
  const ago = Math.max(0, now - Date.parse(iso));
  if (rtf && ago < 7 * 86_400_000) {
    if (ago < 60 * MINUTE) return rtf.format(-Math.floor(ago / MINUTE), 'minute');
    if (ago < 24 * 60 * MINUTE) return rtf.format(-Math.floor(ago / (60 * MINUTE)), 'hour');
    return rtf.format(-Math.floor(ago / (24 * 60 * MINUTE)), 'day');
  }
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

type SortBy = 'last' | 'name';

export default function DevicesScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const queryClient = useQueryClient();
  const { signOutOthers, status } = useDeviceSession();
  const { tier } = useEntitlement();

  const [myDeviceId, setMyDeviceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [learning, setLearning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sortMenu, setSortMenu] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('last');

  useEffect(() => {
    void deviceId().then(setMyDeviceId);
  }, []);

  // The server already returns the last three months, newest first.
  const devices = useQuery({ queryKey: ['devices'], queryFn: fetchDevices });
  const rows = useMemo(() => devices.data ?? [], [devices.data]);
  // Re-read the clock whenever the list is (re)fetched, so relative times and
  // the active count follow a pull-to-refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/purity -- the clock is deliberately keyed to the fetch
  const now = useMemo(() => Date.now(), [devices.dataUpdatedAt]);
  // A failed fetch with nothing cached is not an empty list: offline, `rows`
  // would be [] and the screen would say "only this device" — a claim about
  // the other sessions made without having seen them.
  const failed = devices.isError && !devices.data;
  // Spins only for a pull, not for a background refetch (see `usePullRefresh`).
  const [pulling, setPulling] = useState(false);
  const onPull = () => {
    setPulling(true);
    void devices.refetch().finally(() => setPulling(false));
  };
  // Counting before `deviceId()` resolves would count this phone as another
  // session, and offer to sign it out.
  const ready = !devices.isLoading && myDeviceId !== null;
  const otherLiveCount = ready
    ? rows.filter((row) => row.deviceId !== myDeviceId && !row.revokedAt).length
    : 0;

  // The gate's own counting (`activeDevices`): one row per phone, seen inside
  // the window, not revoked. This phone reads first.
  const active = useMemo(
    () =>
      activeDevices(rows, now).sort(
        (a, b) =>
          Number(b.deviceId === myDeviceId) - Number(a.deviceId === myDeviceId) ||
          Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt),
      ),
    [rows, now, myDeviceId],
  );
  const others = useMemo(() => {
    const live = new Set(active.map((row) => row.deviceId));
    const rest = rows.filter((row) => !live.has(row.deviceId));
    return sortBy === 'name'
      ? rest.sort((a, b) => a.label.localeCompare(b.label, locale))
      : rest.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  }, [rows, active, sortBy, locale]);

  // The server resolves the cap (A/B knobs); the core default covers a phone
  // that has not heard back yet.
  const limit = status?.limit ?? deviceLimitFor(tier);
  const paid = isPaidTier(tier);
  const rtf = useMemo(
    () =>
      typeof Intl.RelativeTimeFormat === 'function'
        ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
        : undefined,
    [locale],
  );

  async function onSignOutOthers() {
    setConfirming(false);
    setBusy(true);
    setMessage(null);
    try {
      const revoked = await signOutOthers();
      // null means the sessions were revoked but the count could not be
      // confirmed; show a plain acknowledgement instead of a false "0 devices".
      setMessage(
        revoked === null ? t.devices.signedOut : plural(locale, revoked, t.devices.signedOutOthers),
      );
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
    } catch (caught) {
      setMessage(friendlyError(caught, t.devices.couldNotSignOut, 'devices.signOutOthers'));
    } finally {
      setBusy(false);
    }
  }

  const card = (row: DeviceSession, live: boolean) => (
    <DeviceCard
      key={`${row.deviceId}-${row.lastSeenAt}`}
      row={row}
      live={live}
      current={row.deviceId === myDeviceId}
      when={lastSeenText(row.lastSeenAt, now, locale, rtf)}
      t={t}
    />
  );

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={theme.color.brand} />
        }
      >
        <ScenicHeader
          title={t.devices.title}
          subtitle={t.devices.subtitle}
          titleAlign="start"
          wash
        />
        <ScenicBody>
          <StandardCard>
            <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
              <Ionicons name="shield-checkmark" size={iconSize.xl} color={theme.color.brand} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="subheading">
                  {fill(paid ? t.devices.infoPaid : t.devices.infoFree, { n: limit })}
                </Text>
                <Text variant="caption" tone="muted">
                  {t.devices.infoBody}
                </Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setLearning(true)} hitSlop={8}>
                <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '700' }}>
                  {t.devices.learnMore}
                </Text>
              </Pressable>
            </Row>
          </StandardCard>

          {failed ? (
            <View style={{ gap: theme.spacing.lg }}>
              <EmptyState
                title={t.loadError}
                body={friendlyError(devices.error, t.loadErrorBody, 'devices.load')}
              />
              {/* The query stays in 'error' while a retry is in flight, so the
                  fetch itself decides what shows here: a spinner until it lands. */}
              {devices.isFetching ? (
                <ActivityIndicator color={theme.color.brand} />
              ) : (
                <Button label={t.retry} onPress={() => void devices.refetch()} />
              )}
            </View>
          ) : !ready ? (
            // Until the list loads, `rows` is empty — showing "only this device"
            // here would tell people they have no other sessions before we know.
            <View style={{ padding: theme.spacing.xl }}>
              <ActivityIndicator color={theme.color.brand} />
            </View>
          ) : (
            <>
              <View style={{ gap: theme.spacing.md }}>
                <SectionHeader
                  title={fill(t.devices.activeTitle, { active: active.length, limit })}
                />
                {active.map((row) => card(row, true))}
                {otherLiveCount === 0 ? (
                  <Text variant="caption" tone="muted" align="center">
                    {t.devices.onlyThisDevice}
                  </Text>
                ) : null}
              </View>

              {others.length > 0 ? (
                <View style={{ gap: theme.spacing.md }}>
                  <SectionHeader
                    title={t.devices.otherTitle}
                    trailing={
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setSortMenu(true)}
                        hitSlop={8}
                      >
                        <Row style={{ gap: 4, alignItems: 'center' }}>
                          <Text variant="caption" tone="muted">
                            {t.devices.sortBy}
                          </Text>
                          <Ionicons
                            name="chevron-down"
                            size={iconSize.sm}
                            color={theme.color.textMuted}
                          />
                        </Row>
                      </Pressable>
                    }
                  />
                  {others.map((row) => card(row, false))}
                </View>
              ) : null}

              <Row style={{ gap: theme.spacing.md }}>
                {otherLiveCount > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => setConfirming(true)}
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.sm,
                      paddingVertical: theme.spacing.md,
                      paddingHorizontal: theme.spacing.lg,
                      borderRadius: theme.radius.pill,
                      backgroundColor: theme.color.brandSoft,
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    <Ionicons
                      name="phone-portrait-outline"
                      size={iconSize.md}
                      color={theme.color.brand}
                    />
                    <Text
                      variant="caption"
                      numberOfLines={2}
                      style={{ flex: 1, color: theme.color.brand, fontWeight: '700' }}
                    >
                      {t.devices.signOutOthers}
                    </Text>
                  </Pressable>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setAdding(true)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                    paddingVertical: theme.spacing.md,
                    paddingHorizontal: theme.spacing.xl,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.color.brand,
                  }}
                >
                  <Ionicons name="add" size={iconSize.md} color={theme.color.onBrand} />
                  <Text variant="caption" style={{ color: theme.color.onBrand, fontWeight: '700' }}>
                    {t.devices.addDevice}
                  </Text>
                </Pressable>
              </Row>
            </>
          )}

          {message ? (
            <Text variant="caption" tone="muted" align="center">
              {message}
            </Text>
          ) : null}

          <Text variant="micro" tone="muted" align="center">
            {t.devices.historyNote}
          </Text>
        </ScenicBody>
      </ScrollView>

      <OverflowMenu
        visible={sortMenu}
        onClose={() => setSortMenu(false)}
        items={[
          { icon: 'time-outline', label: t.devices.sortLast, onPress: () => setSortBy('last') },
          { icon: 'text-outline', label: t.devices.sortName, onPress: () => setSortBy('name') },
        ]}
      />

      <Sheet
        visible={learning}
        onClose={() => setLearning(false)}
        title={t.devices.learnTitle}
        closeLabel={t.common.close}
      >
        <Text variant="body" tone="muted">
          {fill(t.devices.learnBody, {
            free: paid ? FREE_DEVICE_LIMIT : limit,
            pro: paid ? limit : PRO_DEVICE_LIMIT,
            days: DEVICE_ACTIVE_WINDOW_DAYS,
          })}
        </Text>
      </Sheet>

      <Sheet
        visible={adding}
        onClose={() => setAdding(false)}
        title={t.devices.addTitle}
        closeLabel={t.common.close}
      >
        <Text variant="body" tone="muted">
          {t.devices.addBody}
        </Text>
      </Sheet>

      <Popup visible={confirming} onClose={() => setConfirming(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t.devices.signOutAllTitle}</Text>
          <Text variant="body" tone="muted">
            {t.devices.signOutOthersHint}
          </Text>
          <Row style={{ gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                label={t.common.cancel}
                variant="ghost"
                onPress={() => setConfirming(false)}
                fullWidth
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={t.devices.signOutOthers}
                variant="danger"
                onPress={() => void onSignOutOthers()}
                fullWidth
              />
            </View>
          </Row>
        </View>
      </Popup>
    </Screen>
  );
}

function DeviceCard({
  row,
  live,
  current,
  when,
  t,
}: {
  row: DeviceSession;
  live: boolean;
  current: boolean;
  when: string;
  t: ReturnType<typeof useStrings>['t'];
}) {
  const theme = useTheme();
  const tone = live ? LIVE_GREEN : theme.color.textMuted;
  return (
    <StandardCard style={{ opacity: row.revokedAt ? 0.7 : 1 }}>
      <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: current ? theme.color.brandSoft : theme.color.surfaceMuted,
          }}
        >
          <Ionicons
            name={deviceGlyph(row)}
            size={iconSize.xl}
            color={current ? theme.color.brand : theme.color.textMuted}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subheading" numberOfLines={1}>
            {row.label}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {osLabel(row.platform)}
          </Text>
          <Row style={{ gap: 6, alignItems: 'center' }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone }} />
            <Text variant="caption" style={{ color: tone, flexShrink: 1 }}>
              {fill(t.devices.lastActive, { when })}
            </Text>
          </Row>
        </View>
        {current ? (
          <Badge label={t.devices.thisDevice} tone="brand" />
        ) : row.revokedAt ? (
          <Badge label={t.devices.signedOut} tone="neutral" />
        ) : null}
      </Row>
    </StandardCard>
  );
}
