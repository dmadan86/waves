import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { BackHandler, Pressable, ScrollView, View } from 'react-native';

import {
  directionalIcon,
  Row,
  Screen,
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

  // Which point is open as its own page, or none for the index. A page of its
  // own rather than an accordion: each point is a paragraph worth reading
  // whole, and the index stays a clean list of seven doors.
  const [detail, setDetail] = useState<(typeof sections)[number]['id'] | null>(null);
  const current = sections.find((section) => section.id === detail) ?? null;
  const scrollRef = useRef<ScrollView>(null);
  const openDetail = (id: (typeof sections)[number]['id']): void => {
    setDetail(id);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  // Android's back steps out of a point to the index before it leaves.
  useEffect(() => {
    if (!detail) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setDetail(null);
      return true;
    });
    return () => sub.remove();
  }, [detail]);

  const lastUpdated = t.privacy.lastUpdated.replace(
    '{date}',
    new Date(`${POLICY_UPDATED}T12:00:00`).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  );

  return (
    <Screen style={{ backgroundColor: PAGE }}>
      <Row style={{ paddingHorizontal: 20, paddingTop: theme.spacing.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
          hitSlop={10}
          onPress={() => (detail ? setDetail(null) : router.back())}
          style={({ pressed }) => ({
            width: 42,
            height: 42,
            borderRadius: 21,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#FFFFFF',
            borderWidth: 1,
            borderColor: LINE,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name={directionalIcon('chevron-back')} size={20} color={INK} />
        </Pressable>
      </Row>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: clearance, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {current ? (
          <>
            {/* One point, as its own page: a tag, the heading, the line that
                sums it up, the picture, then the whole of what it says. */}
            <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 8 }}>
              <Row
                style={{
                  alignItems: 'center',
                  gap: 8,
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 18,
                  backgroundColor: '#ECE7FD',
                }}
              >
                <Ionicons name={current.icon} size={16} color={ACCENT} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: ACCENT }}>
                  {current.title}
                </Text>
              </Row>
              <Text
                align="center"
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 30,
                  lineHeight: 36,
                  color: INK,
                  letterSpacing: -0.6,
                }}
              >
                {current.title}
              </Text>
              <Text align="center" style={{ fontSize: 16, lineHeight: 23, color: MUTED }}>
                {current.summary}
              </Text>
            </View>
            <PointArt icon={current.icon} />
            <View style={SOFT_CARD}>
              {current.body.split(/\n\n+/).map((paragraph, index) => (
                <Text
                  key={index}
                  style={{
                    fontSize: 15,
                    lineHeight: 23,
                    color: '#3E4260',
                    marginTop: index ? 12 : 0,
                  }}
                >
                  {paragraph}
                </Text>
              ))}
            </View>
            {/* Every point ends on what can be done about it, since that is the
                question reading a policy leaves somebody with. */}
            {current.id !== 'choices' ? (
              <View
                style={[SOFT_CARD, { backgroundColor: '#F3F0FE', flexDirection: 'row', gap: 12 }]}
              >
                <View style={DISC}>
                  <Ionicons name="hand-left-outline" size={20} color={ACCENT} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: INK }}>
                    {t.privacy.choicesTitle}
                  </Text>
                  <Text style={{ fontSize: 14, lineHeight: 20, color: '#3E4260' }}>
                    {t.privacy.choicesBody}
                  </Text>
                </View>
              </View>
            ) : null}
            {session ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.privacy.exportMine}
                onPress={() => router.push('/settings/export')}
                style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, marginTop: 4 })}
              >
                <LinearGradient
                  colors={['#6A45E8', '#8B6CF6']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{
                    height: 54,
                    borderRadius: 18,
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 20,
                    gap: 12,
                  }}
                >
                  <Ionicons name="share-outline" size={20} color="#FFFFFF" />
                  <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>
                    {t.privacy.exportMine}
                  </Text>
                  <Ionicons name={directionalIcon('chevron-forward')} size={18} color="#FFFFFF" />
                </LinearGradient>
              </Pressable>
            ) : null}
            <Text align="center" style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
              {lastUpdated}
            </Text>
          </>
        ) : (
          <>
            {/* The hero: the shield, the heading, and the one-sentence promise. */}
            <ShieldArt />
            <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 10, marginTop: -8 }}>
              <Text
                align="center"
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 36,
                  lineHeight: 42,
                  color: INK,
                  letterSpacing: -0.8,
                }}
              >
                {t.privacy.title}
              </Text>
              <Text align="center" style={{ fontSize: 16, lineHeight: 23, color: MUTED }}>
                {t.privacy.intro}
              </Text>
            </View>

            {/* The policy as doors: one card a point, its gist under the name,
                the whole of it a tap away. Readable signed out too — this is
                the legal page the signed-out gate links to. */}
            <View style={{ gap: 10, marginTop: 8 }}>
              {sections.map((section) => (
                <Pressable
                  key={section.id}
                  accessibilityRole="button"
                  accessibilityLabel={section.title}
                  accessibilityHint={section.summary}
                  onPress={() => openDetail(section.id)}
                  style={({ pressed }) => [SOFT_CARD, rowCard, { opacity: pressed ? 0.85 : 1 }]}
                >
                  <View style={DISC}>
                    <Ionicons name={section.icon} size={21} color={ACCENT} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: INK }}>
                      {section.title}
                    </Text>
                    <Text numberOfLines={2} style={{ fontSize: 13, lineHeight: 18, color: MUTED }}>
                      {section.summary}
                    </Text>
                  </View>
                  <Ionicons name={directionalIcon('chevron-forward')} size={18} color={FAINT} />
                </Pressable>
              ))}
            </View>

            {/* Signed in, the controls over other people's view of you: who may
                find you, who may no longer reach you, and — on a build with a
                Clarity project — whether your use is recorded. */}
            {session ? (
              <View style={{ gap: 8, marginTop: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: MUTED, marginStart: 6 }}>
                  {t.privacy.controlsSection}
                </Text>
                <View style={[SOFT_CARD, { paddingVertical: 4 }]}>
                  <ControlRow
                    icon="search-outline"
                    title={t.person.discoveryRow}
                    subtitle={t.person.discoveryRowHint}
                    onPress={() => router.push('/settings/discovery')}
                  />
                  <View style={{ height: 1, backgroundColor: LINE }} />
                  <ControlRow
                    icon="person-remove-outline"
                    title={t.blocked.row}
                    subtitle={t.blocked.rowHint}
                    trailing={
                      blocked.length > 0
                        ? blocked.length.toLocaleString(locale)
                        : t.privacy.blockedNone
                    }
                    onPress={() => router.push('/settings/blocked')}
                  />
                  {/* Recording can catch names and amounts, so it is a control in
                      the open, not a footnote. Hidden with no Clarity project,
                      where it would toggle nothing. */}
                  {clarityConfigured ? (
                    <>
                      <View style={{ height: 1, backgroundColor: LINE }} />
                      <Row style={{ alignItems: 'center', gap: 12, paddingVertical: 10 }}>
                        <View style={DISC}>
                          <Ionicons name="videocam-outline" size={20} color={ACCENT} />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ fontSize: 15, fontWeight: '700', color: INK }}>
                            {t.privacy.sessionReplayRow}
                          </Text>
                          <Text style={{ fontSize: 13, color: MUTED }}>
                            {t.privacy.sessionReplayHint}
                          </Text>
                        </View>
                        <Toggle
                          value={replay}
                          onValueChange={onReplayChange}
                          accessibilityLabel={t.privacy.sessionReplayRow}
                        />
                      </Row>
                    </>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* One row closes the page, and which one depends on who is reading:
                signed in, who to write to (a policy has to say it); signed out,
                the open-source attributions, since this is the whole of the
                legal surface reachable before signing up. */}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(session ? '/settings/feedback' : '/settings/licenses')}
              style={({ pressed }) => [
                SOFT_CARD,
                rowCard,
                { paddingVertical: 14, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons
                name={session ? 'chatbubble-ellipses-outline' : 'code-slash-outline'}
                size={20}
                color={ACCENT}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: INK }}>
                  {session ? t.privacy.supportRow : t.privacy.licensesRow}
                </Text>
                {session ? (
                  <Text style={{ fontSize: 13, color: MUTED }}>{t.privacy.supportRowHint}</Text>
                ) : null}
              </View>
              <Ionicons name={directionalIcon('chevron-forward')} size={18} color={FAINT} />
            </Pressable>

            <Text align="center" style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
              {lastUpdated}
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** The page's own light palette: the auth pages' ink and lavender. */
const PAGE = '#F6F4FD';
const INK = '#16163A';
const MUTED = '#5C6078';
const FAINT = '#9A9EB2';
const ACCENT = '#6A45E8';
const LINE = '#ECE9F5';
const DISPLAY = 'PlusJakartaSans-ExtraBold';

const SOFT_CARD = {
  backgroundColor: '#FFFFFF',
  borderRadius: 18,
  padding: 16,
  shadowColor: '#2A1E6B',
  shadowOpacity: 0.05,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;
const rowCard = { flexDirection: 'row', alignItems: 'center', gap: 14 } as const;
const DISC = {
  width: 44,
  height: 44,
  borderRadius: 22,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#EFEBFD',
} as const;

function ControlRow({
  icon,
  title,
  subtitle,
  trailing,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  trailing?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [rowCard, { paddingVertical: 10, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={DISC}>
        <Ionicons name={icon} size={20} color={ACCENT} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: INK }}>{title}</Text>
        <Text style={{ fontSize: 13, color: MUTED }}>{subtitle}</Text>
      </View>
      {trailing ? <Text style={{ fontSize: 13, color: MUTED }}>{trailing}</Text> : null}
      <Ionicons name={directionalIcon('chevron-forward')} size={18} color={FAINT} />
    </Pressable>
  );
}

/** The index's picture: a violet shield with its tick, papers and a lock
 *  floating behind it, a leaf at the side. Drawn, so it themes and costs no
 *  asset. */
function ShieldArt() {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 170, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          position: 'absolute',
          width: 230,
          height: 150,
          borderRadius: 90,
          backgroundColor: '#ECE7FD',
          opacity: 0.8,
        }}
      />
      <Ionicons
        name="leaf"
        size={60}
        color="#7FB89F"
        style={{ position: 'absolute', left: 30, bottom: 6, transform: [{ rotate: '-30deg' }] }}
      />
      <View style={[FLOAT, { left: '22%', top: 30, transform: [{ rotate: '-10deg' }] }]}>
        <Ionicons name="document-text" size={26} color="#B9B0F2" />
      </View>
      <View style={[FLOAT, { right: '22%', top: 18, transform: [{ rotate: '8deg' }] }]}>
        <Ionicons name="person" size={24} color="#B9B0F2" />
      </View>
      <View style={[FLOAT, { right: '20%', bottom: 26 }]}>
        <Ionicons name="lock-closed" size={22} color="#7A5CF0" />
      </View>
      <Ionicons name="shield" size={132} color="#6A45E8" />
      <View
        style={{
          position: 'absolute',
          width: 52,
          height: 52,
          borderRadius: 26,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FFFFFF',
        }}
      >
        <Ionicons name="checkmark" size={32} color="#6A45E8" />
      </View>
    </View>
  );
}

const FLOAT = {
  position: 'absolute',
  width: 46,
  height: 52,
  borderRadius: 10,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#FFFFFF',
  shadowColor: '#2A1E6B',
  shadowOpacity: 0.08,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
} as const;

/** A point's picture: its own glyph large on a soft disc, a leaf either side
 *  and a small lock badge, so each page opens on what it is about. */
function PointArt({ icon }: { icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 150, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          position: 'absolute',
          width: 200,
          height: 130,
          borderRadius: 80,
          backgroundColor: '#ECE7FD',
        }}
      />
      <Ionicons
        name="leaf"
        size={54}
        color="#7FB89F"
        style={{ position: 'absolute', left: '18%', bottom: 10, transform: [{ rotate: '-28deg' }] }}
      />
      <Ionicons
        name="leaf"
        size={48}
        color="#8FC7AE"
        style={{ position: 'absolute', right: '18%', bottom: 14, transform: [{ rotate: '26deg' }] }}
      />
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 26,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FFFFFF',
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 5 },
          elevation: 3,
        }}
      >
        <Ionicons name={icon} size={46} color="#6A45E8" />
      </View>
      <View
        style={{
          position: 'absolute',
          right: '32%',
          bottom: 16,
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#6A45E8',
          borderWidth: 3,
          borderColor: '#FFFFFF',
        }}
      >
        <Ionicons name="shield-checkmark" size={18} color="#FFFFFF" />
      </View>
    </View>
  );
}
