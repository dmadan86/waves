/**
 * The wall, and the one card at the top of the screen.
 *
 * Two surfaces, and the whole difference between them is the point of the
 * feature:
 *
 * `UpdateGate` **replaces the app**. It is the only thing in Waves that does,
 * it fires on one condition — the installed build is below
 * `app_releases.minimum_version` — and it exists because a client that computes
 * money wrongly must not keep writing into a ledger other people read.
 *
 * `StatusBanner` **is a card**. Maintenance, an incident, an announcement, a
 * newer build worth having: all four say their piece above whatever screen is
 * showing and change nothing else. Adding an expense during a maintenance
 * window works exactly as it works in a tunnel, because it *is* the tunnel
 * case — the mirror takes the write and the offline queue drains when the
 * servers come back.
 *
 * ## What a force-gated phone does with work it has not synced
 *
 * Nothing is lost and nothing is stranded. `SyncProvider` is mounted above this
 * gate in `_layout.tsx`, so the engine is running while the wall is on screen
 * and the queue drains as it always does; a person who spent a week offline,
 * updated, and reopened Waves would find their expenses already sent. The wall
 * replaces the *view*, never the data: no queue is cleared, no mirror is
 * touched, and the "I have already updated" button re-asks the server so a
 * policy corrected a minute ago takes effect without a reinstall.
 *
 * ## Operator text is rendered as text
 *
 * Every operator sentence reaches these two components through
 * `OperatorText.text`, which @waves/core has already stripped of markup
 * characters, control characters and bidi overrides. Nothing here linkifies it,
 * parses it, or measures it against anything — it is set in a `Text` node, and
 * when it is in a language the reader did not ask for it is labelled as such
 * rather than left as an unexplained wall of a foreign alphabet.
 */

import { useEffect } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AccessibilityInfo, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, iconSize, Row, Text, useTheme } from '@waves/ui';
import { AppGate, NoticeKind, NoticePhase, type Banner, type OperatorText } from '@waves/core';

import { fill, Language, LANGUAGE_NAMES, useStrings, type UiStrings } from '@/i18n';
import { gregorianFormatter } from '@/lib/calendarGrid';
import { usePromptQueueClear } from '@/lib/promptQueue';
import { useAppStatus } from '@/lib/appStatus';

export function UpdateGate({ children }: { children: React.ReactNode }) {
  const { gate } = useAppStatus();
  if (gate !== AppGate.UpdateRequired) return <>{children}</>;
  return <BlockingScreen />;
}

function BlockingScreen(): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const { gateText, installed, latestVersion, openStore, recheck } = useAppStatus();

  // A screen that replaces the app has to say so out loud. Without this a
  // screen reader announces whatever it happens to land on and the person is
  // left wondering why their ledger has become two buttons.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(t.status.blockedAnnouncement);
  }, [t.status.blockedAnnouncement]);

  return (
    <View
      // Modal to assistive tech because nothing behind it is reachable — but it
      // is not a focus trap with no way out: both buttons below do something,
      // and one of them ("I have already updated") is the escape for the case
      // where the policy itself was the mistake.
      accessibilityViewIsModal
      accessibilityRole="alert"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.xl,
        backgroundColor: theme.color.bg,
        padding: theme.spacing.xxxl,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: theme.radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.buttonPrimary,
        }}
      >
        <Ionicons name="arrow-up-circle" size={iconSize.huge} color={theme.color.onBrand} />
      </View>

      <Text variant="heading" align="center">
        {t.extras.needsUpdating}
      </Text>

      <Text variant="caption" tone="muted" align="center">
        {gateText?.text ?? t.misc.versionStoppedBody}
      </Text>
      <WrittenIn text={gateText} align="center" />

      {/* Said plainly, because "will I lose my data" is the actual worry and
          nobody is going to install anything until it is answered. It is also
          literally true: sync runs above this screen, so anything queued on
          this phone is on its way out while they read this. */}
      <Text variant="caption" tone="muted" align="center">
        {t.extras.nothingIsLost}
      </Text>

      <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm }}>
        <Button label={t.misc.updateWaves} size="lg" fullWidth onPress={openStore} />
        <Button
          label={t.misc.alreadyUpdated}
          variant="ghost"
          fullWidth
          onPress={() => void recheck()}
        />
      </View>

      <Text variant="micro" tone="muted" align="center">
        {fill(t.misc.youHaveVersion, { installed })}
        {latestVersion ? fill(t.misc.versionAvailable, { latest: latestVersion }) : ''}
      </Text>
    </View>
  );
}

/**
 * Names the language an operator sentence is in, when it is not the reader's.
 *
 * The alternative — showing English to somebody reading Tamil with no
 * explanation — reads as a bug in the app rather than as a limit on what an
 * operator could translate at 2am. The endonym is used ("English", "தமிழ்")
 * because it is the form somebody recognises without already reading the
 * language it is being described in.
 */
function WrittenIn({
  text,
  align,
}: {
  text: OperatorText | null;
  align?: 'center';
}): React.JSX.Element | null {
  const { t } = useStrings();
  if (!text || text.matchesReader) return null;
  const known = (Object.values(Language) as string[]).includes(text.lang)
    ? LANGUAGE_NAMES[text.lang as Language].own
    : text.lang;
  return (
    <Text variant="micro" tone="faint" align={align}>
      {fill(t.status.writtenIn, { language: known })}
    </Text>
  );
}

/** Title, body, tone and glyph for whatever the banner is carrying. */
interface Wording {
  readonly title: string;
  /** The app's own sentence, in the reader's language. Never empty. */
  readonly body: string;
  /**
   * The operator's words, when there are any, as a line of their own.
   *
   * Deliberately not concatenated onto `body`. The two can be in different
   * languages and therefore different directions, and a right-to-left sentence
   * glued to a left-to-right one inside a single `Text` reorders at the seam
   * into something neither person wrote.
   */
  readonly extra: string | null;
  /** True for everything except a plain announcement: the offline reassurance. */
  readonly reassure: boolean;
  readonly icon:
    'arrow-up-circle-outline' | 'construct-outline' | 'warning-outline' | 'megaphone-outline';
  readonly urgent: boolean;
}

/**
 * One clock, one place.
 *
 * A window is formatted in the reader's own language and numbering system, and
 * pinned to the Gregorian calendar for the same reason the month grid is: the
 * timestamps are Gregorian instants, and an `ar-SA` phone left to itself would
 * label them with Hijri dates that name something else. A day is only shown
 * when the window is not today — "from 02:00 to 04:00" is what somebody needs
 * at 1am, and the date in front of it is noise.
 */
function useWindowText(): (at: number, sameDayAs: number) => string {
  const { locale } = useStrings();
  return (at, sameDayAs) => {
    const time = gregorianFormatter(locale, { hour: 'numeric', minute: '2-digit' });
    const full = gregorianFormatter(locale, {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
    const date = new Date(at);
    const sameDay = new Date(at).toDateString() === new Date(sameDayAs).toDateString();
    const chosen = sameDay ? time : full;
    // No formatter at all is a phone whose engine refused both locales. An ISO
    // instant is ugly and is still a time somebody can read; a crash is not.
    return chosen ? chosen.format(date) : date.toISOString();
  };
}

function wordingFor(
  banner: Banner,
  t: UiStrings,
  now: number,
  when: (at: number, sameDayAs: number) => string,
): Wording {
  if (banner.channel === 'update') {
    return {
      title: fill(t.misc.wavesVersionOut, { latest: banner.latestVersion }),
      body: banner.text?.text ?? t.extras.worthAMinute,
      reassure: false,
      extra: null,
      icon: 'arrow-up-circle-outline',
      urgent: false,
    };
  }

  const extra = banner.text?.text ?? null;

  if (banner.kind === NoticeKind.Maintenance) {
    const starts = banner.startsAt;
    const ends = banner.endsAt;
    const upcoming = banner.phase === NoticePhase.Upcoming;
    // The whole sentence out of two timestamps, in the reader's language and
    // the reader's own time. This is the case the feature is built for: an
    // operator who types nothing at all still reaches a Tamil reader in Tamil.
    // A window with no end cannot be described that way, and the database
    // refuses one, so that branch only says the reassurance underneath.
    const body =
      ends === null
        ? t.status.keepGoing
        : upcoming && starts !== null
          ? fill(t.status.maintenanceFrom, { from: when(starts, now), to: when(ends, starts) })
          : upcoming
            ? fill(t.status.maintenanceSoon, { to: when(ends, now) })
            : fill(t.status.maintenanceUntil, { to: when(ends, now) });
    return {
      title: upcoming ? t.status.maintenancePlanned : t.status.maintenanceNow,
      body,
      extra,
      reassure: ends !== null,
      icon: 'construct-outline',
      urgent: !upcoming,
    };
  }

  if (banner.kind === NoticeKind.Incident) {
    return {
      title: t.status.incident,
      body: t.status.incidentBody,
      extra,
      reassure: true,
      icon: 'warning-outline',
      urgent: true,
    };
  }

  // A plain announcement is only the operator's words — @waves/core drops one
  // with none in any language, so there is always something here. It gets the
  // body line rather than the extra one because there is nothing to sit under.
  return {
    title: t.status.announcement,
    body: extra ?? '',
    extra: null,
    reassure: false,
    icon: 'megaphone-outline',
    urgent: false,
  };
}

/**
 * Sits over the top of whatever screen is showing.
 *
 * Absolute rather than in the layout so that adding it never moves anything: a
 * banner that reflows every screen underneath it is a banner that gets
 * dismissed for the wrong reason. It stands aside while a one-at-a-time prompt
 * owns the screen (`usePromptQueueClear`) without claiming a slot of its own —
 * a maintenance window lasts hours, and holding the queue for that long would
 * quietly starve every prompt below it.
 */
export function StatusBanner(): React.JSX.Element | null {
  const theme = useTheme();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const when = useWindowText();
  const clear = usePromptQueueClear();
  const { banner, dismissNotice, dismissUpdate, now, openStore } = useAppStatus();

  if (!banner || !clear) return null;

  const wording = wordingFor(banner, t, now, when);
  const tint = wording.urgent ? theme.color.warning : theme.color.brand;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + theme.spacing.sm,
        left: theme.spacing.xl,
        right: theme.spacing.xl,
        zIndex: 10,
      }}
    >
      <Card
        // Polite rather than assertive: nothing here is worth interrupting
        // somebody mid-sentence in an amount field, and none of it is an error
        // in what they are doing.
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={{ gap: theme.spacing.sm, ...theme.shadow.lifted }}
      >
        <Row style={{ gap: theme.spacing.md }}>
          <Ionicons name={wording.icon} size={iconSize.xl} color={tint} />
          <View style={{ flex: 1 }}>
            <Text variant="caption">{wording.title}</Text>
            <Text variant="micro" tone="muted">
              {wording.body}
            </Text>
            {wording.extra ? (
              <Text variant="micro" tone="muted">
                {wording.extra}
              </Text>
            ) : null}
            {/* The rule, said to the person it protects. Somebody who reads
                "maintenance" and puts their phone away has lost the expense
                they were about to enter, and the app would have taken it. */}
            {wording.reassure ? (
              <Text variant="micro" tone="muted">
                {t.status.keepGoing}
              </Text>
            ) : null}
            {banner.channel === 'notice' ? <WrittenIn text={banner.text} /> : null}
          </View>
        </Row>
        <Row style={{ gap: theme.spacing.sm }}>
          {banner.channel === 'update' ? (
            <>
              <View style={{ flex: 1 }}>
                <Button label={t.misc.update} size="sm" fullWidth onPress={openStore} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={t.misc.notNow}
                  size="sm"
                  variant="ghost"
                  fullWidth
                  onPress={dismissUpdate}
                />
              </View>
            </>
          ) : (
            <View style={{ flex: 1 }}>
              <Button
                label={t.status.dismiss}
                size="sm"
                variant="ghost"
                fullWidth
                onPress={() => dismissNotice(banner.id)}
              />
            </View>
          )}
        </Row>
      </Card>
    </View>
  );
}
