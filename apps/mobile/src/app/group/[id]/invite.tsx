import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  View,
} from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import { Rect } from 'react-native-svg';

import {
  Avatar,
  Button,
  Callout,
  Card,
  Gradient,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
  useScreenClearance,
} from '@waves/ui';

import { ensureGroupJoinToken, groupJoinLink } from '@/data/api';
import { friendlyError } from '@/lib/errors';
import { useGroup } from '@/data/hooks';
import { useSync } from '@/sync';
import { displayName, groupLabel, isGhost } from '@/data/types';
import { useAuth } from '@/lib/auth';
import { fill, plural, useStrings } from '@/i18n';
import { shareInviteCard } from '@/lib/shareInviteCard';

/**
 * The group's durable join link, as an invitation rather than a naked code.
 *
 * The link is one stable, re-showable token per group — the same one every open
 * and on every device — so the QR paints straight from the mirror with no server
 * round-trip once it exists. The first time a group is ever shared, the token is
 * minted on open (a brief spinner).
 *
 * The screen is built around one card, because that is what a person is really
 * handing over: the group's name, who is already in it, and the code, together.
 * A QR alone says "scan this" and nothing about what is on the other side —
 * whoever is holding out the phone then has to say it out loud. The card says
 * it, and it is what the shared image carries too.
 *
 * Below it, the three ways to send a link are peers on one row, and copying
 * lives on the link itself rather than pretending to be a fourth channel: it is
 * the same link by a different road, and it belongs where the link is. Rotating
 * the token (an admin's lever against a link that has spread too far) is not
 * reachable from here.
 */
export default function InviteScreen() {
  const theme = useTheme();
  const clearance = useScreenClearance();
  const { t, locale } = useStrings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';

  const { group, members } = useGroup(groupId);
  const { profile } = useAuth();
  const { flush } = useSync();

  // The token from the mirror is authoritative; `ensured` is the value ensure/
  // reset just returned, held so the QR appears the instant the RPC replies
  // rather than waiting for the next pull to carry the group row back.
  const [ensured, setEnsured] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inviteCardRef = useRef<View | null>(null);

  const joinToken = group.data?.join_token ?? ensured;
  const link = joinToken ? groupJoinLink(joinToken) : null;

  const ensure = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const token = await ensureGroupJoinToken(groupId);
      setEnsured(token);
      void flush();
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'invite.ensure'));
    } finally {
      setBusy(false);
    }
  };

  // Make the link on open the first time a group is ever shared; if the mirror
  // already carries one, there is nothing to do and the QR is there immediately.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if (group.isLoading || !group.data) return;
    started.current = true;
    // Already have a link from the mirror → nothing to do; the QR is showing.
    if (group.data.join_token) return;
    // Deferred a microtask so the state ensure() sets does not run synchronously
    // inside the effect (that cascades renders); the mint still starts at once.
    void Promise.resolve().then(() => ensure());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.isLoading, group.data]);

  const label = groupLabel(group.data, members.data ?? [], profile?.id);
  const message = t.people.shareMessage.replace('{group}', label).replace('{link}', link ?? '');

  // Who is already here, for the row of faces on the card. Ghosts are people
  // somebody typed in rather than people who arrived, so they are counted —
  // they are in the group — but the `ghost` styling says which is which.
  const present = (members.data ?? []).filter((member) => !member.left_at);
  const faces = present.slice(0, 4);
  const overflow = present.length - faces.length;

  const share = async (): Promise<void> => {
    if (!link) return;
    await Share.share({ message });
  };

  /**
   * Send the complete invitation card, so the person on the other end sees the
   * group name and member context as well as the QR code. `fallback` is the
   * link-only path for when the card cannot be captured.
   */
  const shareCard = async (fallback: () => Promise<void>): Promise<void> => {
    if (!link) return;
    await shareInviteCard({
      cardRef: inviteCardRef,
      filename: 'waves-invite-card.png',
      dialogTitle: message,
      fallback,
    });
  };

  const shareVia = async (channel: 'whatsapp' | 'sms' | 'email'): Promise<void> => {
    if (!link) return;
    const url =
      channel === 'whatsapp'
        ? `whatsapp://send?text=${encodeURIComponent(message)}`
        : channel === 'sms'
          ? `sms:${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(message)}`
          : `mailto:?subject=${encodeURIComponent(t.people.emailSubject.replace('{group}', label))}&body=${encodeURIComponent(message)}`;
    try {
      await Linking.openURL(url);
    } catch {
      await Share.share({ message });
    }
  };

  const copy = async (): Promise<void> => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.close} onPress={() => router.back()}>
          <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
        </IconButton>
        {/* Title only. The group's name was a second line here, but the screen
            is opened from inside that group — it said what the user already
            knew, and a long name pushed the header out of shape. The name now
            sits on the card, where it is part of the invitation instead of a
            label, and travels with the shared image. */}
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.people.inviteTitle}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          // Plus a line's worth, so the closing sentence is not sitting on
          // the navigation bar.
          paddingBottom: clearance + theme.spacing.lg,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {link ? (
          <>
            {/* The invitation. One object: whose group, who is in it, and the
                code to join — on the brand wash, so it reads as something
                handed over rather than a utility panel. */}
            <View ref={inviteCardRef} collapsable={false}>
              <Gradient radius={theme.radius.lg} style={{ padding: theme.spacing.lg }}>
                <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                  <Text variant="title" style={{ color: '#ffffff' }} align="center">
                    {label}
                  </Text>
                  {present.length > 0 ? (
                    <Text variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
                      {plural(locale, present.length, t.people.inviteMembersHere)}
                    </Text>
                  ) : null}
                </View>

                {faces.length > 0 ? (
                  // Overlapped with a negative *start* margin rather than a left
                  // one, so the stack falls the right way round in Arabic.
                  <Row style={{ justifyContent: 'center', marginTop: theme.spacing.md }}>
                    {faces.map((member, index) => (
                      <View
                        key={member.id}
                        style={{
                          marginStart: index === 0 ? 0 : -12,
                          borderRadius: 999,
                          borderWidth: 2,
                          borderColor: '#ffffff',
                        }}
                      >
                        <Avatar
                          name={displayName(member, profile?.id, null, t.misc.someone)}
                          ghost={isGhost(member)}
                          size={36}
                        />
                      </View>
                    ))}
                    {overflow > 0 ? (
                      <View
                        style={{
                          marginStart: -12,
                          width: 36,
                          height: 36,
                          borderRadius: 999,
                          borderWidth: 2,
                          borderColor: '#ffffff',
                          backgroundColor: 'rgba(255,255,255,0.25)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text variant="caption" style={{ color: '#ffffff' }}>
                          {`+${overflow}`}
                        </Text>
                      </View>
                    ) : null}
                  </Row>
                ) : null}

                {/* The code sits on its own white plate whatever the theme is
                  doing: a QR on a dark ground does not scan. */}
                <View
                  style={{
                    alignSelf: 'center',
                    marginTop: theme.spacing.lg,
                    padding: theme.spacing.md,
                    backgroundColor: '#ffffff',
                    borderRadius: theme.radius.lg,
                  }}
                >
                  <QRCodeStyled
                    data={link}
                    size={208}
                    padding={16}
                    style={{ backgroundColor: '#ffffff' }}
                    // The RN `backgroundColor` style is not rasterised by
                    // `toDataURL`, so a captured/shared PNG would come out with a
                    // transparent ground — the dark pieces then vanish on a dark
                    // chat bubble (WhatsApp). Paint the white quiet zone as an SVG
                    // layer behind the code instead, so it is part of the export.
                    renderBackground={() => (
                      <Rect x={-40} y={-40} width={330} height={330} fill="#ffffff" />
                    )}
                    color="#0A0A1A"
                    errorCorrectionLevel="H"
                    pieceBorderRadius="50%"
                    pieceScale={0.92}
                    outerEyesOptions={{ borderRadius: '28%', color: '#0A0A1A' }}
                    innerEyesOptions={{ borderRadius: '35%', color: '#0A0A1A' }}
                    logo={{
                      href: require('../../../../assets/images/icon.png'),
                      scale: 0.85,
                      padding: 6,
                      hidePieces: true,
                    }}
                  />
                </View>

                <Text
                  variant="caption"
                  align="center"
                  style={{ color: 'rgba(255,255,255,0.85)', marginTop: theme.spacing.md }}
                >
                  {t.people.scanToJoin}
                </Text>
              </Gradient>
            </View>

            {/* The link, with copying on it rather than beside it. Copy used to
                be a fifth circle on the channel row, which put the act of taking
                the link somewhere other than the link itself. */}
            <Card style={{ paddingVertical: theme.spacing.sm }}>
              <Row style={{ gap: theme.spacing.sm }}>
                <Ionicons name="link" size={iconSize.md} color={theme.color.textMuted} />
                <Text
                  variant="body"
                  style={{ flex: 1, color: theme.color.brand }}
                  numberOfLines={1}
                  // The token is the end of the URL and the only part that
                  // differs between groups, so it is the half worth keeping.
                  //
                  // Not `selectable`: Android renders selectable text through a
                  // path that ignores `numberOfLines`, so the URL wrapped and
                  // the second line was clipped by the card. Copy is a tap
                  // away, which is the better way to take a link anyway.
                  ellipsizeMode="middle"
                >
                  {link}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copied ? t.misc.copied : t.people.copyLink}
                  onPress={() => void copy()}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: theme.spacing.xs,
                    borderRadius: 999,
                    backgroundColor: theme.color.surfaceMuted,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={iconSize.sm}
                    color={theme.color.brand}
                  />
                  <Text variant="caption" style={{ color: theme.color.brand }}>
                    {copied ? t.misc.copied : t.people.copyLink}
                  </Text>
                </Pressable>
              </Row>
            </Card>

            {/* The quick roads: each one opens an app with the link already
                written. A named channel beats the OS sheet when you already know
                where this person lives. */}
            <Row style={{ gap: theme.spacing.md }}>
              {(
                [
                  {
                    channel: 'whatsapp',
                    label: t.people.whatsapp,
                    icon: 'logo-whatsapp',
                    color: '#25D366',
                  },
                  { channel: 'sms', label: t.extras.sms, icon: 'chatbubble', color: '#1E88E5' },
                  { channel: 'email', label: t.extras.email, icon: 'mail', color: '#EA4335' },
                ] as const
              ).map((option) => (
                <Pressable
                  key={option.channel}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  onPress={() => void shareVia(option.channel)}
                  style={({ pressed }) => ({
                    flex: 1,
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  {/* An explicit square. `width: '100%'` with `aspectRatio`
                      resolved against the column and came out a tall oval on a
                      real screen; a circle is one number, not a proportion. */}
                  <View
                    style={{
                      width: 60,
                      height: 60,
                      borderRadius: 30,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: option.color,
                    }}
                  >
                    <Ionicons name={option.icon} size={iconSize.lg} color="#ffffff" />
                  </View>
                  <Text variant="caption" tone="muted" align="center" numberOfLines={1}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </Row>

            {/* Everything else the phone can do with an invitation, and the one
                path that sends the code as a picture. */}
            <Button
              label={t.people.shareInvite}
              size="lg"
              fullWidth
              onPress={() => void shareCard(share)}
            />

            {/* Said once, at the bottom, naming the group it lets people into —
                a warning is only useful if it says what is being opened. */}
            <Text variant="caption" tone="muted" align="center">
              {fill(t.people.inviteTrust, { group: label })}
            </Text>
          </>
        ) : error ? (
          // Minting failed — a retry, not a first step.
          <Button
            label={t.people.createLink}
            size="lg"
            fullWidth
            disabled={busy}
            onPress={() => void ensure()}
          />
        ) : (
          // First-ever share (or still loading): the durable link is being made.
          // Hold the card's place so the screen reads as "your code is coming".
          <Card
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: theme.spacing.xxxl,
              gap: theme.spacing.md,
            }}
          >
            <ActivityIndicator color={theme.color.brand} />
            <Text variant="caption" tone="muted">
              {t.common.loading}
            </Text>
          </Card>
        )}

        {error ? <Callout tone="negative">{error}</Callout> : null}
      </ScrollView>
    </Screen>
  );
}
