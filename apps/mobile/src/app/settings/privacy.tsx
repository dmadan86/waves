import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';

import { iconSize, Sheet, Text, Toggle, useTabBarClearance, useTheme } from '@waves/ui';

import { VoiceConsentSheet } from '@/components/VoiceConsentSheet';
import { PlainHeader } from '@/components/standard/PlainHeader';
import { RowTile } from '@/components/standard/RowTile';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard/parts';
import { useBlockedUsers } from '@/data/blocked';
import { useVoiceAgentEnabled } from '@/data/hooks';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useVoiceConsent } from '@/lib/voiceConsentStore';
import { useFollowUpPrefs } from '@/lib/followUpPrefs';
import { setEnabled as setFollowUpsEnabled } from '@waves/core';
import { clarityConfigured } from '@/lib/clarity';
import { openAdPrivacyOptions } from '@/lib/adsSdk';
import { router } from '@/lib/navigation';
import { sessionReplayConsent, setSessionReplayConsent } from '@/lib/sessionReplay';
import { useAdChoicesVisible } from '@/lib/useAdChoicesVisible';
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
 * The screen has two readers. Somebody arriving from Settings came to *do*
 * something, so the controls come first; somebody arriving from the legal line
 * on the signed-out gate came to *read*, so for them the policy card is first
 * and there are no account controls. Either way it is the standard design: a
 * plain header and a few cards of one-line rows. The points of the policy are
 * one row each; the full text opens in a sheet instead of a page of its own.
 */

/** When the policy text below last changed. Shown, because an undated policy is not one. */
const POLICY_UPDATED = '2026-10-22';

export default function PrivacyScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const toast = useToast();
  const adChoices = useAdChoicesVisible();
  // The controls act on an account a signed-out reader does not have yet, so
  // they are shown only once there is a session (a guest counts — they have
  // data to manage).
  const { session } = useAuth();
  const { blocked } = useBlockedUsers();
  const voiceAgentOn = useVoiceAgentEnabled();
  const voiceConsent = useVoiceConsent(session?.user?.id);
  const followUps = useFollowUpPrefs(session?.user?.id);
  const [consentSheet, setConsentSheet] = useState(false);

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
      setReplay(!value);
      toast.show(t.privacy.couldNotSave, 'negative');
    });
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

  // The point whose full text is open in the sheet, or none.
  const [detail, setDetail] = useState<(typeof sections)[number]['id'] | null>(null);
  const current = sections.find((section) => section.id === detail) ?? null;

  const lastUpdated = t.privacy.lastUpdated.replace(
    '{date}',
    new Date(`${POLICY_UPDATED}T12:00:00`).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  );

  const tile = (icon: keyof typeof Ionicons.glyphMap) => (
    <RowTile tint={theme.color.brandSoft}>
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.brand} />
    </RowTile>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <PlainHeader title={t.privacy.title} />

        <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.lg }}>
          {/* Signed in, the controls over other people's view of you: who may
              find you, who may no longer reach you, and — on a build with a
              Clarity project — whether your use is recorded. */}
          {session ? (
            <View style={{ gap: theme.spacing.md }}>
              <SectionHeader title={t.privacy.controlsSection} />
              <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
                <ListRow
                  leading={tile('search-outline')}
                  title={t.person.discoveryRow}
                  subtitle={t.person.discoveryRowHint}
                  divider
                  onPress={() => router.push('/settings/discovery')}
                />
                <ListRow
                  leading={tile('person-remove-outline')}
                  title={t.blocked.row}
                  subtitle={t.blocked.rowHint}
                  divider={adChoices || clarityConfigured || voiceAgentOn}
                  trailing={
                    <Text variant="caption" tone="muted">
                      {blocked.length > 0
                        ? blocked.length.toLocaleString(locale)
                        : t.privacy.blockedNone}
                    </Text>
                  }
                  onPress={() => router.push('/settings/blocked')}
                />
                {/* Google's consent form for reward ads (EEA, UK, Switzerland). Only for
                    people who can be offered an ad; the SDK loads when it is tapped. */}
                {adChoices ? (
                  <ListRow
                    leading={tile('options-outline')}
                    title={t.rewardedAds.adChoicesRow}
                    subtitle={t.rewardedAds.adChoicesHint}
                    divider={clarityConfigured || voiceAgentOn}
                    onPress={() => {
                      void openAdPrivacyOptions().then((result) => {
                        if (result === 'none') toast.show(t.rewardedAds.adChoicesNone, 'info');
                      });
                    }}
                  />
                ) : null}
                {/* Recording can catch names and amounts, so it is a control in
                    the open, not a footnote. Hidden with no Clarity project,
                    where it would toggle nothing. */}
                {clarityConfigured ? (
                  <ListRow
                    leading={tile('videocam-outline')}
                    title={t.privacy.sessionReplayRow}
                    subtitle={t.privacy.sessionReplayHint}
                    divider={voiceAgentOn}
                    trailing={
                      <Toggle
                        value={replay}
                        onValueChange={onReplayChange}
                        accessibilityLabel={t.privacy.sessionReplayRow}
                      />
                    }
                  />
                ) : null}
                {/* Advanced voice (Pro): revoke or re-grant consent to send voice to
                    cloud providers. Visible only when the agent is enabled. */}
                {voiceAgentOn ? (
                  <ListRow
                    leading={tile('cloud-outline')}
                    title={t.voiceConsent.row}
                    subtitle={t.voiceConsent.toggle}
                    divider
                    trailing={
                      <Toggle
                        value={voiceConsent.state === 'granted'}
                        disabled={!voiceConsent.ready}
                        onValueChange={(on: boolean) => {
                          if (on) setConsentSheet(true);
                          else voiceConsent.revoke();
                        }}
                        accessibilityLabel={t.voiceConsent.row}
                      />
                    }
                  />
                ) : null}
                {/* The assistant's short questions after adding an expense (stored on this phone). */}
                {voiceAgentOn ? (
                  <ListRow
                    leading={tile('chatbubble-ellipses-outline')}
                    title={t.followUps.settingsRow}
                    subtitle={t.followUps.settingsHint}
                    trailing={
                      <Toggle
                        value={followUps.prefs.enabled}
                        disabled={!followUps.ready}
                        onValueChange={(on: boolean) =>
                          followUps.update((p) => setFollowUpsEnabled(p, on))
                        }
                        accessibilityLabel={t.followUps.settingsRow}
                      />
                    }
                  />
                ) : null}
              </StandardCard>
            </View>
          ) : null}

          {/* What this phone has connected to, kept only on it (local, so offered
              signed out too), and — signed in — the export of everything held. */}
          <View style={{ gap: theme.spacing.md }}>
            <SectionHeader title={t.privacy.dataSection} />
            <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
              <ListRow
                leading={tile('pulse-outline')}
                title={t.netlog.row}
                subtitle={t.netlog.rowHint}
                divider={Boolean(session)}
                onPress={() => router.push('/settings/network-activity')}
              />
              {session ? (
                <ListRow
                  leading={tile('share-outline')}
                  title={t.privacy.exportMine}
                  onPress={() => router.push('/settings/export')}
                />
              ) : null}
            </StandardCard>
          </View>

          {/* The policy as one row a point; the whole of each opens in a sheet.
              Readable signed out too — this is the legal page the signed-out
              gate links to. */}
          <View style={{ gap: theme.spacing.md }}>
            <SectionHeader title={t.privacy.policySection} />
            <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
              {sections.map((section) => (
                <ListRow
                  key={section.id}
                  leading={tile(section.icon)}
                  title={section.title}
                  divider
                  onPress={() => setDetail(section.id)}
                />
              ))}
              {/* One row closes the card, and which one depends on who is reading:
                  signed in, who to write to (a policy has to say it); signed out,
                  the open-source attributions, since this is the whole of the
                  legal surface reachable before signing up. */}
              <ListRow
                leading={tile(session ? 'chatbubble-ellipses-outline' : 'code-slash-outline')}
                title={session ? t.privacy.supportRow : t.privacy.licensesRow}
                onPress={() => router.push(session ? '/settings/feedback' : '/settings/licenses')}
              />
            </StandardCard>
            <Text variant="micro" tone="muted" style={{ textAlign: 'center' }}>
              {lastUpdated}
            </Text>
          </View>
        </View>
      </ScrollView>

      <Sheet
        visible={current !== null}
        onClose={() => setDetail(null)}
        title={current?.title}
        closeLabel={t.common.close}
        style={{ maxHeight: '85%' }}
      >
        {current ? (
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
              <Text style={{ fontWeight: '600' }}>{current.summary}</Text>
              {current.body.split(/\n\n+/).map((paragraph, index) => (
                <Text key={index} tone="muted">
                  {paragraph}
                </Text>
              ))}
              <Text variant="micro" tone="muted">
                {lastUpdated}
              </Text>
            </View>
          </ScrollView>
        ) : null}
      </Sheet>
      <VoiceConsentSheet
        visible={consentSheet}
        onAllow={() => {
          voiceConsent.allow();
          setConsentSheet(false);
        }}
        onNotNow={() => setConsentSheet(false)}
      />
    </View>
  );
}
