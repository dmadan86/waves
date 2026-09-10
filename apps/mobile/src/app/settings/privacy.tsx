import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LayoutAnimation, Pressable, ScrollView, View } from 'react-native';

import {
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  ListRow,
  Row,
  Screen,
  SectionHeader,
  Text,
  Toggle,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useBlockedUsers } from '@/data/blocked';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { clarityConfigured } from '@/lib/clarity';
import { router } from '@/lib/navigation';
import { useReducedMotion } from '@/lib/reducedMotion';
import { sessionReplayConsent, setSessionReplayConsent } from '@/lib/sessionReplay';
import { useToast } from '@/lib/toast';

/**
 * What Waves holds about you, and who can see you.
 *
 * THE RULE THIS SCREEN AND SETTINGS DIVIDE ON. Please keep it, or the two drift
 * back into two copies of each other — which is exactly what had happened:
 * App lock, Export and Delete each appeared on both, dressed differently in
 * each place, so the same act looked like two different acts.
 *
 *   Settings (`(tabs)/profile.tsx`) is where you change how the app behaves,
 *   and where you end things — the whole account included.
 *   Privacy is where you find out what is held about you, and decide who else
 *   can see it. Controls over *other people's* view of you belong here. Controls
 *   over your own copy of the app do not.
 *
 * Being findable is not a reason to add a row. Everything is already findable
 * from Settings, and a second menu is not a shortcut — it is a fork, and forks
 * fall out of step. There is exactly one deliberate exception, named below: the
 * contact line, because a policy that does not say who to write to is not a
 * policy. That test is what moved three rows off this screen:
 *
 *   App lock protects the phone, not the record, and Settings has a Security
 *   group which is where people go looking for it — Splitwise, Cash App, Wise,
 *   Monzo, Telegram and Revolut all file a biometric lock under a heading
 *   called Security, never under Privacy.
 *   Open-source licenses were never privacy at all, and already sit under
 *   Settings → Help.
 *   Export and Delete are account acts, and every app worth copying keeps them
 *   together under the account: WhatsApp pairs "Request account info" with
 *   "Delete my account", X puts "Download an archive" directly above
 *   "Deactivate", Instagram offers the export *inside* the delete flow — which
 *   is what `settings/delete-account` does too. Their home is Settings; the
 *   policy below still says plainly that both are yours to use.
 *
 * What is left is the shape a real privacy screen has: who can find you, who
 * may no longer reach you, what of your use is recorded, and the disclosure
 * itself. Every claim in that disclosure is one this codebase can be checked
 * against — row-level security on every table (ADR-013), receipts in a private
 * bucket behind signed links, the offline mirror sealed at rest
 * (`sync/rowCipher`), crash reports scrubbed before they leave the phone,
 * export free and lossless (ADR-012). A policy that promises something the code
 * does not do is worse than no policy, because it is the one people rely on.
 *
 * The screen has two readers and serves them in two different orders. Somebody
 * arriving from Settings came to *do* something — see who they blocked, stop
 * the recording — so for them the controls come first and the prose is folded
 * down to a line each, opened on a tap. Somebody arriving from the legal line
 * on the signed-out gate came to *read* the policy, so for them the same text
 * is the page, open from the start, with no account controls that would act on
 * an account they do not have.
 */

/** When the policy text below last changed. Shown, because an undated policy is not one. */
const POLICY_UPDATED = '2026-09-10';

export default function PrivacyScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const toast = useToast();
  const reduceMotion = useReducedMotion();
  // The controls act on an account a signed-out reader does not have yet, so
  // they are shown only once there is a session (a guest counts — they have
  // data to manage).
  const { session } = useAuth();
  const { blocked } = useBlockedUsers();

  // The session-replay opt-in, mirrored from storage. Only meaningful when a
  // Clarity project is configured; on a build without one the switch is hidden
  // rather than shown doing nothing.
  const [replay, setReplay] = useState(false);
  useEffect(() => {
    void sessionReplayConsent().then(setReplay);
  }, []);

  // Optimistic, then honest: if the consent does not persist, the switch goes
  // back to what is actually stored rather than showing a choice that will not
  // survive the next launch. This one is a consent to be recorded, so a switch
  // that lies about it is the worst kind.
  const onReplayChange = (value: boolean): void => {
    setReplay(value);
    void setSessionReplayConsent(value).catch(() => {
      // The switch has already flipped back, which is the real message. The line
      // only says why, and a line that only says why does not need a door.
      setReplay(!value);
      toast.show(t.privacy.couldNotSave, 'negative');
    });
  };

  // Which policy points are open. Signed out this screen *is* the policy, so
  // every point starts open and the summaries are just headings above the text;
  // signed in they start folded, one line each, out of the way of the controls.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (id: string): boolean => open[id] ?? !session;
  const toggleSection = (id: string): void => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((prev) => ({ ...prev, [id]: !(prev[id] ?? !session) }));
  };

  const sections = [
    {
      id: 'store',
      title: t.privacy.storeTitle,
      summary: t.privacy.storeSummary,
      body: t.privacy.storeBody,
      icon: 'file-tray-outline',
    },
    {
      id: 'protect',
      title: t.privacy.protectTitle,
      summary: t.privacy.protectSummary,
      body: t.privacy.protectBody,
      icon: 'lock-closed-outline',
    },
    {
      id: 'device',
      title: t.privacy.deviceTitle,
      summary: t.privacy.deviceSummary,
      body: t.privacy.deviceBody,
      icon: 'phone-portrait-outline',
    },
    {
      id: 'services',
      title: t.privacy.servicesTitle,
      summary: t.privacy.servicesSummary,
      body: t.privacy.servicesBody,
      icon: 'cloud-outline',
    },
    {
      id: 'analytics',
      title: t.privacy.analyticsTitle,
      summary: t.privacy.analyticsSummary,
      body: t.privacy.analyticsBody,
      icon: 'stats-chart-outline',
    },
    {
      id: 'retention',
      title: t.privacy.retentionTitle,
      summary: t.privacy.retentionSummary,
      body: t.privacy.retentionBody,
      icon: 'hourglass-outline',
    },
    {
      id: 'choices',
      title: t.privacy.choicesTitle,
      summary: t.privacy.choicesSummary,
      body: t.privacy.choicesBody,
      icon: 'hand-left-outline',
    },
  ] as const;

  const chevron = (
    <Ionicons
      name={directionalIcon('chevron-forward')}
      size={iconSize.md}
      color={theme.color.textFaint}
    />
  );

  /** A right-hand status word — the state at a glance, without a sentence. */
  const status = (label: string) => (
    <Text variant="caption" tone="muted">
      {label}
    </Text>
  );

  const divider = <View style={{ height: 1, backgroundColor: theme.color.border }} />;

  return (
    <Screen>
      {/* Back on the left, the title lifted out of the bar into the hero
          below — the policy leads with a symbol and a heading centred on the
          page, the way Apple's own privacy sheets open. */}
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1 }} />
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
        <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <Ionicons name="shield-checkmark-outline" size={64} color={theme.color.text} />
          <Text
            align="center"
            style={{
              fontSize: 30,
              lineHeight: 38,
              fontWeight: '800',
              letterSpacing: -0.5,
              color: theme.color.text,
            }}
          >
            {t.privacy.title}
          </Text>
          <Text variant="body" tone="muted" align="center">
            {t.privacy.intro}
          </Text>
        </View>

        {/* Signed in, the controls come before the policy prose. They are one
            question asked at three ranges: who may find you at all, who may no
            longer reach you, and what of your use is watched — the last of
            which is only there on a build with a Clarity project, so on the
            rest the question stops at two. */}
        {session ? (
          <View style={{ gap: theme.spacing.sm }}>
            <SectionHeader title={t.privacy.controlsSection} />
            <Card style={{ paddingVertical: theme.spacing.xs }}>
              <ListRow
                title={t.person.discoveryRow}
                subtitle={t.person.discoveryRowHint}
                onPress={() => router.push('/settings/discovery')}
                leading={
                  <Ionicons name="search-outline" size={iconSize.md} color={theme.color.brand} />
                }
                trailing={chevron}
              />
              {divider}
              <ListRow
                title={t.blocked.row}
                subtitle={t.blocked.rowHint}
                onPress={() => router.push('/settings/blocked')}
                leading={
                  <Ionicons
                    name="person-remove-outline"
                    size={iconSize.md}
                    color={theme.color.brand}
                  />
                }
                trailing={
                  <Row style={{ gap: theme.spacing.xs }}>
                    {status(
                      blocked.length > 0
                        ? blocked.length.toLocaleString(locale)
                        : t.privacy.blockedNone,
                    )}
                    {chevron}
                  </Row>
                }
              />
              {/* Recording can catch names and amounts, so it is a control in
                  the open, not a footnote. Hidden entirely with no Clarity
                  project, where it would toggle nothing. */}
              {clarityConfigured ? (
                <>
                  {divider}
                  <ListRow
                    title={t.privacy.sessionReplayRow}
                    subtitle={t.privacy.sessionReplayHint}
                    leading={
                      <Ionicons
                        name="videocam-outline"
                        size={iconSize.md}
                        color={theme.color.brand}
                      />
                    }
                    trailing={
                      <Toggle
                        value={replay}
                        onValueChange={onReplayChange}
                        accessibilityLabel={t.privacy.sessionReplayRow}
                      />
                    }
                  />
                </>
              ) : null}
            </Card>
          </View>
        ) : null}

        {/* Signed in this is an accordion — a glyph, the point, one line of what
            it says, the paragraph on a tap. Signed out it is a document: every
            body open, nothing pressable, and no chevron. A policy read by a
            screen reader should not be a run of "button, expanded". */}
        <View style={{ gap: theme.spacing.sm }}>
          {session ? <SectionHeader title={t.privacy.policySection} /> : null}
          <View style={{ gap: theme.spacing.lg }}>
            {sections.map((section) => {
              const expanded = isOpen(section.id);
              const content = (
                <Row style={{ alignItems: 'flex-start', gap: theme.spacing.md }}>
                  <Ionicons
                    name={section.icon}
                    size={iconSize.md}
                    color={theme.color.brand}
                    style={{ marginTop: 2 }}
                  />
                  <View style={{ flex: 1, gap: theme.spacing.xs }}>
                    <Text variant="subheading">{section.title}</Text>
                    <Text variant="body" tone="muted">
                      {expanded ? section.body : section.summary}
                    </Text>
                  </View>
                  {session ? (
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={iconSize.sm}
                      color={theme.color.textFaint}
                      style={{ marginTop: 4 }}
                    />
                  ) : null}
                </Row>
              );

              if (!session) return <View key={section.id}>{content}</View>;

              return (
                <Pressable
                  key={section.id}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={section.title}
                  accessibilityHint={expanded ? t.privacy.collapseLabel : t.privacy.expandLabel}
                  onPress={() => toggleSection(section.id)}
                  // The row is a deliberate control, not a paragraph that happens
                  // to react: padding and a 44pt floor make it one to the thumb.
                  style={({ pressed }) => ({
                    minHeight: 44,
                    justifyContent: 'center',
                    paddingVertical: theme.spacing.xs,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  {content}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* One row closes the page, and which one depends on who is reading.
            Signed in it is the contact line every policy has to carry — a line,
            not a menu row, which is why there is no section header above it.
            Signed out the feedback form has no account to attach a message to,
            and this screen is instead the whole of the legal surface somebody
            can reach before they have signed up, so it carries the open-source
            attributions that otherwise live under Settings. Those two are
            alternatives, never a pair — signed out is the only way to reach the
            licenses from here, so that half is not a second door at all.
            The contact row is one, and knowingly: it opens the same feedback
            form as Settings, under a different name. That is the single place
            the one-door rule is broken on purpose, because a policy has to say
            who to write to, and "Send feedback", three screens away and named
            for something else, is not saying it. Keep both pointed at the same
            route and the fork stays a label rather than a second thing to
            maintain. */}
        <Card style={{ paddingVertical: theme.spacing.xs }}>
          {session ? (
            <ListRow
              title={t.privacy.supportRow}
              subtitle={t.privacy.supportRowHint}
              onPress={() => router.push('/settings/feedback')}
              leading={
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={iconSize.md}
                  color={theme.color.brand}
                />
              }
              trailing={chevron}
            />
          ) : (
            <ListRow
              title={t.privacy.licensesRow}
              onPress={() => router.push('/settings/licenses')}
              leading={
                <Ionicons name="code-slash-outline" size={iconSize.md} color={theme.color.brand} />
              }
              trailing={chevron}
            />
          )}
        </Card>

        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="micro" tone="muted">
            {t.privacy.lastUpdated.replace(
              '{date}',
              new Date(`${POLICY_UPDATED}T12:00:00`).toLocaleDateString(locale, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }),
            )}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
