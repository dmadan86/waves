import { useEffect, useState, type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  directionalIcon,
  EmptyState,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';

import { fill, plural, useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';

import { acceptInvite, previewInvite, type InvitePreview } from '@/data/api';
import { keys } from '@/data/hooks';
import { useAuth } from '@/lib/auth';
import { useGuestGuard } from '@/lib/guestGuard';
import { backend } from '@/lib/backend';
import { expectGroup } from '@/lib/groupArrival';
import { requestJoinPushPrompt } from '@/lib/pushPromptStore';
import { guestJoins } from '@/lib/guestJoins';
import { router, useGoBack } from '@/lib/navigation';
import { useSync } from '@/sync';
import { TranslucentBackButton } from '@/components/ContactPickerScene';

/**
 * Landing screen for an invite link (ADR-006).
 *
 * The link shows a real preview of the group before asking for anything, and
 * the "is one of these you?" step is the ghost-claim flow: pick your name and
 * every expense already recorded against it becomes yours.
 */
export default function JoinScreen() {
  const theme = useTheme();
  const { t, locale } = useStrings();
  // `from` says how the link was opened. The scanner sends `scan`, because a
  // link that turns out to be dead has a different next step there: point the
  // camera at another code, rather than being shown the door to the app.
  const { token, from } = useLocalSearchParams<{ token?: string; from?: string }>();
  const { session, continueAsGuest } = useAuth();
  const guard = useGuestGuard();
  const queryClient = useQueryClient();
  const { flush } = useSync();
  const goBack = useGoBack('/');
  const { width, height: windowHeight } = useWindowDimensions();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [busy, setBusy] = useState(Boolean(token));
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The group whose admin has been asked, once a claim has been sent. */
  const [pending, setPending] = useState<string | null>(null);

  /**
   * Whether the route parameters have had a chance to arrive.
   *
   * A link with no token looked like something that could be judged during the
   * first render. It cannot: a deep link is parsed a frame later, so on a real
   * invite opened on a real phone the screen said "This link is missing its
   * invite code" and then went on saying it while the group name, the member
   * list and a working Join button loaded underneath. Waiting a tick before
   * calling a link broken is the whole fix.
   */
  const [settled, setSettled] = useState(Boolean(token));
  useEffect(() => {
    if (settled) return;
    const timer = setTimeout(() => setSettled(true), 0);
    return () => clearTimeout(timer);
  }, [settled]);

  const shown = error ?? (!token && settled ? t.misc.linkMissingCode : null);

  useEffect(() => {
    let active = true;
    if (!token) return;
    void (async () => {
      try {
        const result = await previewInvite(token);
        if (active) setPreview(result);
      } catch (caught) {
        if (active) setError(friendlyError(caught, t.misc.couldNotJoin, 'join.preview'));
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token, t.misc.couldNotJoin]);

  /**
   * `claim` is passed rather than read from state because "join as someone new
   * instead" clears it and joins in the same tap — and a state update is not
   * visible to the call that follows it, so the old claim would be sent again.
   */
  const join = async (claim: string | null = claimId): Promise<void> => {
    if (!token) return;
    // An existing guest holds one group (ADR-006 addendum); joining a second
    // sends them to sign up instead. A brand-new person with no session yet is
    // not a guest, so `guard.gate` is null and their first join is never gated.
    if (guard.blockAddGroup()) return;
    setJoining(true);
    setError(null);
    try {
      // Nobody is forced to register to accept an invite.
      if (!session) await continueAsGuest();
      const result = await acceptInvite({ token, claimMemberId: claim });
      // Claiming somebody's place only asks. Routing into the group here would
      // land on a screen the person cannot read yet, because they are not a
      // member until an admin agrees.
      if ('pending' in result) {
        setPending(result.group.name);
        return;
      }

      // A guest's way into this group, kept in case they later find their
      // Google or Apple login already has an account and switch to it: the link
      // is how that account joins this group again (`lib/guestSwitch`). Only a
      // join that went through; a claim still waiting on an admin is not a
      // membership, and replaying it would skip the admin's answer. Never
      // allowed to cost the join itself.
      void rememberGuestJoin(token);

      await queryClient.invalidateQueries({ queryKey: keys.groups });
      // The membership exists on the server; this phone's mirror does not have
      // the group yet, and the group screens read the mirror. Pull it before
      // landing there, and say it is expected so a flush that was already in
      // flight (and answered before the join) cannot make the screen announce
      // "not found" — it keeps loading until the group arrives or the window ends.
      // Twice on purpose: a flush already in flight is joined rather than
      // restarted, and that one never asked for this group. The second runs
      // fresh with the id. Bounded, so a hung request cannot hold the button.
      expectGroup(result.group.id);
      const pull = async (): Promise<void> => {
        await flush([result.group.id]).catch(() => undefined);
        await flush([result.group.id]).catch(() => undefined);
      };
      await Promise.race([pull(), new Promise<void>((done) => setTimeout(done, 6_000))]);
      router.replace(`/group/${result.group.id}`);
      // A good moment to offer notifications, if the phone is not yet set up.
      requestJoinPushPrompt(result.group.name);
    } catch (caught) {
      setError(friendlyError(caught, t.misc.couldNotJoin, 'join.accept'));
    } finally {
      setJoining(false);
    }
  };

  if (busy) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.color.brand} />
        </View>
      </Screen>
    );
  }

  if (!preview?.group) {
    return (
      <Screen>
        <BackRow onPress={goBack} label={t.common.back} />
        <EmptyState
          title={t.misc.linkExpired}
          body={shown ?? t.misc.linkExpiredBody}
          action={
            from === 'scan' ? (
              <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                <Button label={t.misc.scanAnother} onPress={() => router.replace('/scan')} />
                <Button
                  label={t.misc.goToWaves}
                  variant="ghost"
                  onPress={() => router.replace('/')}
                />
              </View>
            ) : (
              <Button label={t.misc.goToWaves} onPress={() => router.replace('/')} />
            )
          }
        />
      </Screen>
    );
  }

  if (pending) {
    const claimed = preview.claimable.find((candidate) => candidate.memberId === claimId);
    return (
      <Screen edges={['top', 'bottom']}>
        <BackRow onPress={goBack} label={t.common.back} />
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            paddingHorizontal: theme.spacing.xl,
            gap: theme.spacing.xl,
          }}
        >
          <Card style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <Ionicons name="hourglass-outline" size={iconSize.hero} color={theme.color.brand} />
            <Text variant="subheading" align="center">
              {t.claims.waitingTitle}
            </Text>
            <Text variant="caption" tone="muted" align="center">
              {fill(t.claims.waitingBody, {
                group: pending,
                name: claimed?.name ?? t.misc.unnamed,
              })}
            </Text>
          </Card>

          {/* The way out of waiting on an admin who never opens the app. The
              claim is left standing: if they answer it later and this person
              has since joined as themselves, the approval refuses rather than
              making them a member twice. */}
          <Button
            label={t.claims.joinAsNewInstead}
            variant="secondary"
            fullWidth
            disabled={joining}
            onPress={() => {
              setClaimId(null);
              setPending(null);
              void join(null);
            }}
          />
          <Button label={t.misc.goToWaves} variant="ghost" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  const features: { icon: ComponentProps<typeof Ionicons>['name']; title: string; body: string }[] =
    [
      { icon: 'flash', title: t.misc.joinFeatureQuickTitle, body: t.misc.joinFeatureQuickBody },
      {
        icon: 'shield-outline',
        title: t.misc.joinFeatureGuestTitle,
        body: t.misc.joinFeatureGuestBody,
      },
      {
        icon: 'people',
        title: t.misc.joinFeatureTogetherTitle,
        body: t.misc.joinFeatureTogetherBody,
      },
    ];

  // The foot scene is backdrop, not content: on a short screen it would sit
  // under the button, so it is left out rather than shrunk to a sliver.
  const showScene = windowHeight >= 700;
  // Roughly square art: about 70% of the width, capped, and smaller on short
  // screens so the Join button stays in view without scrolling.
  const heroSize = Math.min(
    width * 0.7,
    300,
    windowHeight < 700 ? 150 : windowHeight < 800 ? 190 : 300,
  );

  return (
    <Screen edges={['top', 'bottom']}>
      {showScene ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width,
            height: (width * 330) / 849,
          }}
        >
          <Image
            source={SCENE}
            accessible={false}
            resizeMode="contain"
            style={{ width: '100%', height: '100%' }}
          />
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={{
          paddingBottom: theme.spacing.xl,
          gap: theme.spacing.lg,
          flexGrow: 1,
        }}
      >
        <BackRow onPress={goBack} label={t.common.back} />
        <View style={{ alignItems: 'center' }}>
          <Image
            source={HERO}
            accessible={false}
            resizeMode="contain"
            style={{ width: heroSize, height: heroSize * (1000 / 1010) }}
          />
          {/* The card overlaps the foot of the art, which is painted with its own
              ground and would otherwise show a seam. */}
          <Card
            style={{
              alignItems: 'center',
              gap: theme.spacing.sm,
              marginTop: -20,
              marginHorizontal: theme.spacing.xl,
              alignSelf: 'stretch',
            }}
          >
            <Text variant="title" align="center">
              {preview.group.name}
            </Text>
            <Text variant="caption" tone="muted" align="center">
              {plural(locale, preview.memberCount, t.misc.peopleSplitting)}
            </Text>
            <Badge label={t.misc.freeNoAccount} tone="positive" />
            <Row style={{ alignItems: 'flex-start', marginTop: theme.spacing.sm }}>
              {features.map((feature, index) => (
                <Row key={feature.icon} style={{ flex: 1, alignItems: 'stretch' }}>
                  {index > 0 ? (
                    <View style={{ width: 1, backgroundColor: theme.color.border }} />
                  ) : null}
                  <View style={{ flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 4 }}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      <Ionicons
                        name={feature.icon}
                        size={iconSize.base}
                        color={theme.color.brand}
                      />
                    </View>
                    <Text variant="micro" align="center" style={{ fontWeight: '700' }}>
                      {feature.title}
                    </Text>
                    <Text variant="micro" tone="muted" align="center" numberOfLines={2}>
                      {feature.body}
                    </Text>
                  </View>
                </Row>
              ))}
            </Row>
          </Card>
        </View>

        <View style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.lg }}>
          {preview.claimable.length > 0 ? (
            <Card style={{ gap: theme.spacing.md }}>
              <Text variant="subheading">{t.misc.isOneOfTheseYou}</Text>
              <Text variant="caption" tone="muted">
                {t.extras.claimHistoryNote}
              </Text>
              <Row style={{ flexWrap: 'wrap', gap: theme.spacing.md }}>
                {preview.claimable.map((candidate) => (
                  <Pressable
                    key={candidate.memberId}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: claimId === candidate.memberId }}
                    accessibilityLabel={candidate.name ?? t.misc.unnamed}
                    onPress={() =>
                      setClaimId((current) =>
                        current === candidate.memberId ? null : candidate.memberId,
                      )
                    }
                    style={{
                      alignItems: 'center',
                      gap: 4,
                      opacity: claimId === candidate.memberId ? 1 : 0.5,
                    }}
                  >
                    <Avatar name={candidate.name ?? '?'} ghost size={52} />
                    <Text variant="micro" tone={claimId === candidate.memberId ? 'brand' : 'muted'}>
                      {candidate.name ?? t.misc.unnamed}
                    </Text>
                  </Pressable>
                ))}
              </Row>
              {claimId ? (
                <Row style={{ gap: theme.spacing.sm }}>
                  <Ionicons
                    name="information-circle-outline"
                    size={iconSize.base}
                    color={theme.color.brand}
                  />
                  <Text variant="micro" tone="brand" style={{ flex: 1 }}>
                    {`${t.extras.theirPastBecomesYours} ${t.claims.needsConfirming}`}
                  </Text>
                </Row>
              ) : null}
            </Card>
          ) : null}

          {shown ? <Callout tone="negative">{shown}</Callout> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: joining, busy: joining }}
            disabled={joining}
            onPress={() => void join()}
            style={({ pressed }) => ({
              minHeight: 54,
              borderRadius: 27,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.sm,
              backgroundColor: pressed ? theme.color.brandPressed : theme.color.brand,
              opacity: joining ? 0.7 : 1,
            })}
          >
            {/* Claiming asks; joining as somebody new does not. The button says
              which of the two is about to happen. */}
            <Text variant="subheading" style={{ color: theme.color.onBrand }}>
              {claimId
                ? fill(t.claims.askToJoinAs, {
                    name:
                      preview.claimable.find((candidate) => candidate.memberId === claimId)?.name ??
                      t.misc.unnamed,
                  })
                : t.misc.joinGroup}
            </Text>
            {joining ? (
              <ActivityIndicator color={theme.color.onBrand} />
            ) : (
              <Ionicons
                name={directionalIcon('arrow-forward')}
                size={iconSize.base}
                color={theme.color.onBrand}
              />
            )}
          </Pressable>

          <Row style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
            <Ionicons
              name="shield-checkmark-outline"
              size={iconSize.base}
              color={theme.color.brand}
            />
            <Text variant="micro" tone="muted" style={{ flex: 1 }}>
              {t.extras.guestKeepsItHere}
            </Text>
          </Row>
        </View>
      </ScrollView>
    </Screen>
  );
}

const HERO = require('../../assets/images/join-hero.webp') as number;
const SCENE = require('../../assets/images/join-scene.webp') as number;

/** The round back button, on the page background above whatever state follows. */
function BackRow({ onPress, label }: { onPress: () => void; label: string }) {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.xs }}>
      <TranslucentBackButton dark label={label} onPress={onPress} />
    </View>
  );
}

/** Remembers `token` against the signed-in account, if that account is a guest. */
async function rememberGuestJoin(token: string): Promise<void> {
  try {
    const { data } = await backend.auth.getSession();
    const user = data.session?.user;
    if (user?.is_anonymous !== true) return;
    await guestJoins.remember(user.id, token);
  } catch {
    // A lost note costs one rejoin later, never this join.
  }
}
