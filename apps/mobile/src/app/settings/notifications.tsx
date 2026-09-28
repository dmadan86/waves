import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';

import {
  directionalIcon,
  Divider,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  Toggle,
  useTabBarClearance,
  useTheme,
  type TintName,
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
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';
import {
  enablePush,
  ensureLocalNotificationPermission,
  PushFailure,
  PushPermission,
  pushPermission,
} from '@/lib/push';

type IconName = ComponentProps<typeof Ionicons>['name'];
type PrefRow = {
  key: keyof NotificationPrefs;
  title: string;
  body: string;
  icon: IconName;
  /** The disc's pastel, from the theme's tints. */
  tint: TintName;
};

/** The push notifications — everything the phone delivers. */
function pushRows(t: UiStrings): PrefRow[] {
  return [
    {
      key: 'involvesMe',
      title: t.notifications.involvesMe,
      body: t.notifications.involvesMeBody,
      icon: 'people-outline',
      tint: 'lilac',
    },
    {
      key: 'settlementRequests',
      title: t.notifications.settlementRequests,
      body: t.notifications.settlementRequestsBody,
      icon: 'swap-horizontal-outline',
      tint: 'mint',
    },
    {
      key: 'nudges',
      title: t.notifications.nudges,
      body: t.notifications.nudgesBody,
      icon: 'notifications-outline',
      tint: 'peach',
    },
    {
      key: 'groupActivityDigest',
      title: t.notifications.digest,
      body: t.notifications.digestBody,
      icon: 'newspaper-outline',
      tint: 'sky',
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
      tint: 'sky',
    },
    {
      key: 'weeklyEmail',
      title: t.notifications.weeklyEmail,
      body: t.notifications.weeklyEmailBody,
      icon: 'document-text-outline',
      tint: 'lilac',
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

  const dark = theme.scheme === 'dark';
  const ink = dark ? theme.color.text : SPEC_INK;
  const muted = dark ? theme.color.textMuted : SPEC_MUTED;
  const accent = dark ? theme.color.brand : SPEC_ACCENT;
  const pill =
    permission === 'granted'
      ? { label: t.notifications.granted, fg: theme.color.positive, bg: theme.color.positiveSoft }
      : permission === 'denied'
        ? { label: t.notifications.denied, fg: theme.color.negative, bg: theme.color.negativeSoft }
        : {
            label: t.notifications.undetermined,
            fg: theme.color.textMuted,
            bg: theme.color.surfaceMuted,
          };

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          alignItems: 'center',
          gap: theme.spacing.xs,
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons name={directionalIcon('chevron-back')} size={iconSize.lg} color={ink} />
        </IconButton>
        <Text style={{ flex: 1, fontSize: 26, lineHeight: 32, fontWeight: '800', color: ink }}>
          {t.notifications.title}
        </Text>
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          paddingTop: theme.spacing.md,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ADR-010: the competition is simultaneously spammy and silent. These
            defaults are the fix, and they are all off-switchable — said once at
            the top, on a lavender band with a bell beside it. */}
        <Row
          style={{
            gap: 12,
            padding: theme.spacing.md,
            borderRadius: 20,
            overflow: 'hidden',
            backgroundColor: dark ? theme.color.surfaceMuted : '#EEEBFC',
          }}
        >
          <Disc
            icon="shield-checkmark"
            color={accent}
            bg={dark ? theme.color.surface : '#E1DCFA'}
          />
          <View style={{ flex: 1, minWidth: 0, gap: 2, paddingEnd: 64 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: ink }}>
              {t.notifications.importantTitle}
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 18, color: muted }}>
              {t.notifications.neverSpam}
            </Text>
          </View>
          <BellArt />
        </Row>

        {/* The master switch: nothing below fires until the phone itself is
            allowed to deliver, so this device-permission state leads. */}
        <SoftCard>
          <Row style={{ gap: 12, alignItems: 'flex-start' }}>
            <Disc icon="phone-portrait-outline" color={ink} bg={theme.color.surfaceMuted} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: ink }}>
                {t.notifications.onThisPhone}
              </Text>
              <Text style={{ fontSize: 13, lineHeight: 18, color: muted }}>
                {permission === 'granted'
                  ? t.notifications.permissionOn
                  : permission === 'denied'
                    ? t.notifications.permissionOff
                    : t.notifications.permissionUnset}
              </Text>
            </View>
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 12,
                backgroundColor: pill.bg,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: pill.fg }}>{pill.label}</Text>
            </View>
          </Row>
          {permission === 'granted' ? null : (
            // Denied is past asking: the system will not show the prompt again,
            // so the button takes them to Waves in the phone's own settings.
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: asking, busy: asking }}
              disabled={asking}
              onPress={() =>
                permission === 'denied' ? void Linking.openSettings() : void turnOnPush()
              }
              style={({ pressed }) => ({
                height: 44,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: accent,
                opacity: asking ? 0.6 : pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
                {asking ? t.notifications.asking : t.notifications.turnOn}
              </Text>
            </Pressable>
          )}
        </SoftCard>

        {loading ? (
          <ActivityIndicator color={theme.color.brand} />
        ) : (
          <>
            <SectionHead title={t.notifications.pushSection} sub={t.notifications.pushSub} />
            <PrefSection rows={pushRows(t)} prefs={prefs} onToggle={toggle} />

            {/* Its own card because it is a different promise. Everything above
                is something our servers send; this is the phone setting an
                alarm on itself, out of what it already holds — nothing about
                these drafts is read by anything but this device. */}
            <SectionHead title={t.notifications.localSection} />
            <SoftCard style={{ paddingVertical: 4 }}>
              <PrefLine
                icon="file-tray-outline"
                tint={theme.tint.sky}
                title={t.notifications.savedForLater}
                body={t.notifications.savedForLaterBody}
                // `null` is "still reading the stored value", which reads as off
                // rather than flashing on; disabled until known so a tap cannot
                // race the read and save the default over a person's choice.
                value={nudge === true}
                disabled={nudge === null}
                onChange={(value) => void toggleNudge(value)}
              />
            </SoftCard>

            <SectionHead title={t.notifications.emailSection} sub={t.notifications.emailSub} />
            <PrefSection rows={emailRows(t)} prefs={prefs} onToggle={toggle} />
          </>
        )}

        {status ? (
          <Text variant="caption" tone={status === t.account.saved ? 'positive' : 'negative'}>
            {status}
          </Text>
        ) : null}

        <Row
          style={{
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 14,
            backgroundColor: dark ? theme.color.surfaceMuted : '#EEECF7',
          }}
        >
          <Ionicons name="information-circle-outline" size={18} color={muted} />
          <Text style={{ flex: 1, fontSize: 11, lineHeight: 16, color: muted }}>
            {t.notifications.footnote}
          </Text>
        </Row>
      </ScrollView>
    </Screen>
  );
}

/** A white card with the redesign's soft corners and lift. */
function SoftCard({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.color.surface,
          borderRadius: 20,
          padding: theme.spacing.md,
          gap: theme.spacing.md,
          shadowColor: '#2A1E6B',
          shadowOpacity: theme.scheme === 'dark' ? 0 : 0.06,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A glyph on its own soft disc. */
function Disc({ icon, color, bg }: { icon: IconName; color: string; bg: string }) {
  return (
    <View
      style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
      }}
    >
      <Ionicons name={icon} size={20} color={color} />
    </View>
  );
}

/** A section's bold title with its line under it, above its card. */
function SectionHead({ title, sub }: { title: string; sub?: string }) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return (
    <View style={{ marginTop: theme.spacing.sm, paddingHorizontal: 4 }}>
      <Text style={{ fontSize: 18, fontWeight: '800', color: dark ? theme.color.text : SPEC_INK }}>
        {title}
      </Text>
      {sub ? (
        <Text style={{ fontSize: 13, color: dark ? theme.color.textMuted : SPEC_MUTED }}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** The banner's bell: a violet bell ringing over a card, drawn from glyphs. */
function BellArt() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', right: 8, top: 14, width: 72, height: 76 }}
    >
      <View
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 56,
          height: 40,
          borderRadius: 8,
          backgroundColor: dark ? theme.color.surface : '#FFFFFF',
          opacity: 0.8,
          transform: [{ rotate: '10deg' }],
        }}
      />
      <Ionicons
        name="notifications"
        size={42}
        color={dark ? theme.color.brand : '#7B6CF0'}
        style={{ position: 'absolute', left: 4, top: 8, transform: [{ rotate: '-14deg' }] }}
      />
      {[
        { top: 2, left: 44, rotate: '20deg' },
        { top: 12, left: 54, rotate: '55deg' },
        { top: 26, left: 58, rotate: '85deg' },
      ].map((ray, index) => (
        <View
          key={index}
          style={{
            position: 'absolute',
            top: ray.top,
            left: ray.left,
            width: 3,
            height: 10,
            borderRadius: 2,
            backgroundColor: dark ? theme.color.brand : '#7B6CF0',
            transform: [{ rotate: ray.rotate }],
          }}
        />
      ))}
    </View>
  );
}

/** One preference: its glyph on a tinted disc, the name over what it does, and
 *  the switch. */
function PrefLine({
  icon,
  tint,
  title,
  body,
  value,
  disabled,
  onChange,
}: {
  icon: IconName;
  tint: { bg: string; ink: string };
  title: string;
  body: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return (
    <Row style={{ gap: 12, paddingVertical: 10, alignItems: 'flex-start' }}>
      <Disc icon={icon} color={tint.ink} bg={tint.bg} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{ fontSize: 15, fontWeight: '700', color: dark ? theme.color.text : SPEC_INK }}
        >
          {title}
        </Text>
        <Text
          style={{ fontSize: 13, lineHeight: 18, color: dark ? theme.color.textMuted : SPEC_MUTED }}
        >
          {body}
        </Text>
      </View>
      <Toggle
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        accessibilityLabel={title}
      />
    </Row>
  );
}

/**
 * One card of preference toggles, shared by the push and email sections: a
 * tinted disc leading each row, the name over a full-wrapping line on what it
 * does (the bodies run to two lines, so not a single-line `ListRow`), a
 * `Toggle` trailing, and a hairline between rows.
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
    <SoftCard style={{ paddingVertical: 4, gap: 0 }}>
      {rows.map((row, index) => (
        <View key={row.key}>
          {index > 0 ? <Divider /> : null}
          <PrefLine
            icon={row.icon}
            tint={theme.tint[row.tint]}
            title={row.title}
            body={row.body}
            value={prefs[row.key]}
            onChange={(value) => onToggle(row.key, value)}
          />
        </View>
      ))}
    </SoftCard>
  );
}
