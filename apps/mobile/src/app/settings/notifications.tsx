import { useEffect, useState, type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import {
  Badge,
  Button,
  Callout,
  Card,
  directionalIcon,
  Divider,
  IconButton,
  iconSize,
  Row,
  Screen,
  SectionHeader,
  Text,
  Toggle,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import {
  DEFAULT_NOTIFICATION_PREFS,
  fetchNotificationPrefs,
  saveNotificationPrefs,
  type NotificationPrefs,
} from '@/data/api';
import { useStrings, type UiStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { useAuth } from '@/lib/auth';
import { loadCaptureNudgeEnabled, saveCaptureNudgeEnabled } from '@/lib/captureNudge/settings';
import { useCaptureNudgePass, useNudgePassInputs } from '@/lib/captureNudge/useNudgePass';
import { router } from '@/lib/navigation';
import {
  enablePush,
  ensureLocalNotificationPermission,
  PushFailure,
  PushPermission,
  pushPermission,
} from '@/lib/push';

type IconName = ComponentProps<typeof Ionicons>['name'];
type PrefRow = { key: keyof NotificationPrefs; title: string; body: string; icon: IconName };

/** The push notifications — everything the phone delivers. */
function pushRows(t: UiStrings): PrefRow[] {
  return [
    {
      key: 'involvesMe',
      title: t.notifications.involvesMe,
      body: t.notifications.involvesMeBody,
      icon: 'people-outline',
    },
    {
      key: 'settlementRequests',
      title: t.notifications.settlementRequests,
      body: t.notifications.settlementRequestsBody,
      icon: 'swap-horizontal-outline',
    },
    {
      key: 'nudges',
      title: t.notifications.nudges,
      body: t.notifications.nudgesBody,
      icon: 'hand-left-outline',
    },
    {
      key: 'groupActivityDigest',
      title: t.notifications.digest,
      body: t.notifications.digestBody,
      icon: 'newspaper-outline',
    },
  ];
}

/**
 * The email door, which is not the phone's.
 *
 * `email` is the master switch — `waves_claim_email_notifications` has read it
 * since M4 and suppressed every mail when it is false, and until now there was
 * no screen anywhere that could set it. It leads, because turning it off makes
 * the row under it moot.
 */
function emailRows(t: UiStrings): PrefRow[] {
  return [
    {
      key: 'email',
      title: t.notifications.emailAll,
      body: t.notifications.emailAllBody,
      icon: 'mail-outline',
    },
    {
      key: 'weeklyEmail',
      title: t.notifications.weeklyEmail,
      body: t.notifications.weeklyEmailBody,
      icon: 'newspaper-outline',
    },
  ];
}

/**
 * What went wrong, said to the person it happened to.
 *
 * Only `denied` is theirs to undo, and only that one sends them to their phone
 * settings. Telling somebody to check their settings when the real problem is
 * that this build has no Firebase key sends them somewhere that cannot help.
 */
function pushFailureCopy(t: UiStrings): Record<PushFailure, string> {
  return {
    [PushFailure.Denied]: t.notifications.failDenied,
    [PushFailure.Unsupported]: t.notifications.failUnsupported,
    [PushFailure.NotSignedIn]: t.notifications.failNotSignedIn,
    [PushFailure.NotConfigured]: t.notifications.failNotConfigured,
    [PushFailure.SaveFailed]: t.notifications.failSaveFailed,
  };
}

export default function NotificationSettingsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const { profile } = useAuth();

  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [permission, setPermission] = useState<PushPermission>(PushPermission.Undetermined);
  const [asking, setAsking] = useState(false);

  // The one switch on this screen that is not a server preference: the reminder
  // this phone raises itself about expenses saved for later. It is stored on
  // the device, because the device is the only thing that can obey it — see
  // `lib/captureNudge/settings.ts`. `null` means "still reading", which keeps
  // the switch from flicking on and then off again on a phone where it is off.
  const [nudge, setNudge] = useState<boolean | null>(null);
  const nudgeInputs = useNudgePassInputs();
  const runNudgePass = useCaptureNudgePass(nudgeInputs);

  useEffect(() => {
    const ownerId = profile?.id;
    if (!ownerId) return;
    let active = true;
    void loadCaptureNudgeEnabled(ownerId).then((value) => {
      if (active) setNudge(value);
    });
    return () => {
      active = false;
    };
  }, [profile?.id]);

  useEffect(() => {
    let active = true;
    void pushPermission().then((value) => {
      if (active) setPermission(value);
    });
    return () => {
      active = false;
    };
  }, []);

  /**
   * The prompt happens here, having read what it is for — never on launch. On
   * iOS a denial is close to permanent: the only way back is Settings, which
   * nobody visits.
   */
  const turnOnPush = async (): Promise<void> => {
    setAsking(true);
    setStatus(null);
    try {
      const result = await enablePush();
      setPermission(await pushPermission());
      if (!result.ok) setStatus(pushFailureCopy(t)[result.why]);
    } finally {
      setAsking(false);
    }
  };

  useEffect(() => {
    if (!profile?.id) return;
    let active = true;
    void (async () => {
      try {
        const loaded = await fetchNotificationPrefs(profile.id);
        if (active) setPrefs(loaded);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [profile?.id]);

  /**
   * The device-side switch.
   *
   * Turning it **on** asks the operating system first, and only when it has to
   * — a control the person has just touched, having read what it is for, which
   * is the same door `enablePush` and the soft ask use and the only one this
   * app ever opens. A refusal puts the switch back rather than leaving it on
   * over a permission that will silently swallow every reminder.
   *
   * Either way a pass runs immediately afterwards, so turning it off clears
   * tonight's reminder now and turning it on sets one now. A switch whose
   * effect waits for the next foreground is a switch people press twice.
   */
  const toggleNudge = async (value: boolean): Promise<void> => {
    const ownerId = profile?.id;
    if (!ownerId) {
      setStatus(t.notifications.failNotSignedIn);
      return;
    }
    setStatus(null);
    if (value) {
      const allowed = await ensureLocalNotificationPermission();
      setPermission(await pushPermission());
      if (!allowed) {
        setNudge(false);
        setStatus(t.notifications.failDenied);
        return;
      }
    }
    setNudge(value);
    try {
      await saveCaptureNudgeEnabled(ownerId, value);
    } catch (caught: unknown) {
      setNudge(!value);
      setStatus(friendlyError(caught, t.notifications.failSaveFailed, 'notifications.saveNudge'));
      return;
    }
    runNudgePass();
  };

  const toggle = (key: keyof NotificationPrefs, value: boolean): void => {
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    if (!profile?.id) {
      setStatus(t.notifications.failNotSignedIn);
      return;
    }
    setPrefs(next);
    setStatus(null);
    void saveNotificationPrefs(profile.id, next)
      .then(() => setStatus(t.account.saved))
      .catch((caught: unknown) => {
        // The switch goes back to what the server still holds, so the screen
        // never shows a preference that was not saved.
        setPrefs(previous);
        setStatus(friendlyError(caught, t.notifications.failSaveFailed, 'notifications.savePrefs'));
      });
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
          <Text variant="heading">{t.notifications.title}</Text>
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
        {/* ADR-010: the competition is simultaneously spammy and silent. These
            defaults are the fix, and they are all off-switchable. The promise is
            a "read this" note, so it wears the app's canonical Callout shape
            (info tone) rather than a hand-rolled brand banner. */}
        <Callout
          tone="info"
          icon={(color) => (
            <Ionicons name="shield-checkmark-outline" size={iconSize.md} color={color} />
          )}
        >
          {t.notifications.neverSpam}
        </Callout>

        {/* The master switch: nothing below fires until the phone itself is
            allowed to deliver, so this device-permission state leads. */}
        <Card style={{ gap: theme.spacing.md }}>
          <Row gap={theme.spacing.md}>
            <Ionicons name="phone-portrait-outline" size={iconSize.xl} color={theme.color.text} />
            <View style={{ flex: 1 }}>
              <Text variant="subheading">{t.notifications.onThisPhone}</Text>
              <Text variant="caption" tone="muted">
                {permission === 'granted'
                  ? t.notifications.permissionOn
                  : permission === 'denied'
                    ? t.notifications.permissionOff
                    : t.notifications.permissionUnset}
              </Text>
            </View>
            <Badge
              label={
                permission === 'granted'
                  ? t.notifications.granted
                  : permission === 'denied'
                    ? t.notifications.denied
                    : t.notifications.undetermined
              }
              tone={permission === 'granted' ? 'positive' : undefined}
            />
          </Row>
          {permission === 'granted' ? null : (
            <Button
              label={asking ? t.notifications.asking : t.notifications.turnOn}
              size="sm"
              disabled={asking || permission === 'denied'}
              onPress={() => void turnOnPush()}
            />
          )}
        </Card>

        {loading ? (
          <ActivityIndicator color={theme.color.brand} />
        ) : (
          <>
            <View style={{ gap: theme.spacing.sm }}>
              <SectionHeader title={t.notifications.pushSection} />
              <PrefSection rows={pushRows(t)} prefs={prefs} onToggle={toggle} />
            </View>
            {/* Its own section because it is a different promise. Everything
                above is something our servers send; this is the phone setting
                an alarm on itself, out of what it already holds — nothing about
                these drafts is read by anything but this device. Grouping it
                with the four above would quietly claim otherwise. */}
            <View style={{ gap: theme.spacing.sm }}>
              <SectionHeader title={t.notifications.localSection} />
              <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
                <Row gap={theme.spacing.md} style={{ paddingVertical: theme.spacing.md }}>
                  <Ionicons
                    name="file-tray-outline"
                    size={iconSize.xl}
                    color={theme.color.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="subheading">{t.notifications.savedForLater}</Text>
                    <Text variant="caption" tone="muted">
                      {t.notifications.savedForLaterBody}
                    </Text>
                  </View>
                  <Toggle
                    // `null` is "still reading the stored value", which reads as
                    // off rather than flashing on; the switch is disabled until
                    // it is known so a tap cannot race the read and save the
                    // default back over a person's own choice.
                    value={nudge === true}
                    disabled={nudge === null}
                    onValueChange={(value) => void toggleNudge(value)}
                    accessibilityLabel={t.notifications.savedForLater}
                  />
                </Row>
              </Card>
            </View>

            <View style={{ gap: theme.spacing.sm }}>
              <SectionHeader title={t.notifications.emailSection} />
              <PrefSection rows={emailRows(t)} prefs={prefs} onToggle={toggle} />
            </View>
          </>
        )}

        {status ? (
          <Text variant="caption" tone={status === t.account.saved ? 'positive' : 'negative'}>
            {status}
          </Text>
        ) : null}

        <Text variant="micro" tone="muted" align="center">
          {t.notifications.footnote}
        </Text>
      </ScrollView>
    </Screen>
  );
}

/**
 * One grouped card of preference toggles, shared by the push and email
 * sections. Built from the same primitives the other settings lists use: a
 * `Card` holding a stack of `Row`s with a hairline `Divider` between each, a
 * quiet leading glyph anchoring the left, and a `Toggle` as the trailing
 * control (the pattern the devices and sync screens share).
 *
 * The bodies run to two lines, so each row is a plain `Row` with a
 * full-wrapping caption rather than a single-line `ListRow` that would clip the
 * explanation — the same reason the devices list rolls its own row.
 */
function PrefSection({
  rows,
  prefs,
  onToggle,
}: {
  rows: PrefRow[];
  prefs: NotificationPrefs;
  onToggle: (key: keyof NotificationPrefs, value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
      {rows.map((row, index) => (
        <View key={row.key}>
          {index > 0 ? <Divider /> : null}
          <Row gap={theme.spacing.md} style={{ paddingVertical: theme.spacing.md }}>
            <Ionicons name={row.icon} size={iconSize.xl} color={theme.color.textMuted} />
            <View style={{ flex: 1 }}>
              <Text variant="subheading">{row.title}</Text>
              <Text variant="caption" tone="muted">
                {row.body}
              </Text>
            </View>
            <Toggle
              value={prefs[row.key]}
              onValueChange={(value) => onToggle(row.key, value)}
              accessibilityLabel={row.title}
            />
          </Row>
        </View>
      ))}
    </Card>
  );
}
