import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import { Rect } from 'react-native-svg';

import {
  Avatar,
  Button,
  Callout,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
  useScreenClearance,
} from '@waves/ui';

import { ensureGroupJoinToken, groupJoinLink } from '@/data/api';
import { requestDemoGate } from '@/demo/gateStore';
import { isDemoGroupId } from '@/demo/ids';
import { friendlyError } from '@/lib/errors';
import { useGroup } from '@/data/hooks';
import { router } from '@/lib/navigation';
import { useSync } from '@/sync';
import { displayName, groupLabel, GroupType, isGhost } from '@/data/types';
import { useAuth } from '@/lib/auth';
import { fill, plural, useStrings } from '@/i18n';
import { shareInviteCard } from '@/lib/shareInviteCard';

const FRIENDS = require('../../../../assets/images/welcome-friends.webp') as number;

// Sizes that make the screen fit one phone (~800dp) with no scrolling: header
// ~50, illustration 112 (16 of it under the card), card ~350, share row ~95,
// button 48, trust line ~28 and the gaps between.
const ILLUSTRATION_HEIGHT = 112;
const QR_SIZE = 148;
const BRACKET_GAP = 8;
// Room kept at the end of the group row for the members pill that floats over it.
const PILL_RESERVE = 112;

/** The glyph for the round badge, by group type (same set the new-group screen uses). */
const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  [GroupType.Trip]: 'airplane',
  [GroupType.Home]: 'home',
  [GroupType.Couple]: 'heart',
  [GroupType.Event]: 'people',
  [GroupType.Friends]: 'people',
};

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
    // The demo trip has no row on the server for a join link to point at —
    // inviting into it would be a real invite into a group that does not
    // exist. Same sheet every other blocked demo write shows.
    if (isDemoGroupId(groupId)) {
      requestDemoGate();
      return;
    }
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
    // The demo trip never gets a token at all — see `ensure()`.
    if (isDemoGroupId(groupId)) return;
    // Deferred a microtask so the state ensure() sets does not run synchronously
    // inside the effect (that cascades renders); the mint still starts at once.
    void Promise.resolve().then(() => ensure());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.isLoading, group.data, groupId]);

  const label = groupLabel(group.data, members.data ?? [], profile?.id);
  const message = t.people.shareMessage.replace('{group}', label).replace('{link}', link ?? '');

  // Who is already here, for the row of faces on the card. Ghosts are people
  // somebody typed in rather than people who arrived, so they are counted —
  // they are in the group — but the `ghost` styling says which is which.
  // "Scan this QR code to join the trip". Only types that read naturally after
  // "the" get their own word; couple/other fall back to the plain "group".
  const typeKey = group.data?.type;
  const typeWord = (
    typeKey === GroupType.Trip ||
    typeKey === GroupType.Home ||
    typeKey === GroupType.Event ||
    typeKey === GroupType.Friends
      ? t.groupExport.types[typeKey]
      : t.groupExport.types.other
  ).toLowerCase();

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
      // No WhatsApp scheme handler (not installed, or iOS not allow-listing it):
      // the web link opens the app if present or the web page if not.
      if (channel === 'whatsapp') {
        try {
          await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
          return;
        } catch {
          // fall through to the system sheet
        }
      }
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
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs }}>
        <IconButton label={t.common.close} onPress={() => router.back()}>
          <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
        </IconButton>
        {/* Title and a one-line promise. The group's name is not here: the
            screen is opened from inside that group, so it said what the user
            already knew. It sits on the card, where it is part of the
            invitation and travels with the shared image. The title is a notch
            under the `heading` size so the whole screen fits without a scroll. */}
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading" style={{ fontSize: 22, lineHeight: 27 }}>
            {t.people.inviteTitle}
          </Text>
          <Text variant="caption" tone="muted" align="center" numberOfLines={2}>
            {t.people.inviteSubtitle}
          </Text>
        </View>
        {/* Balances the close button so the title stays centred. */}
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.xs,
          // Plus a little, so the closing line is not sitting on the
          // navigation bar. Everything is sized to fit one phone without
          // scrolling; the ScrollView is only the net for big text sizes.
          paddingBottom: clearance + theme.spacing.sm,
          gap: theme.spacing.sm,
        }}
        showsVerticalScrollIndicator={false}
      >
        {link ? (
          <>
            {/* Friends above the card, cropped from the top so it is faces that
                show and the table is hidden by the card riding over it. Kept
                short on purpose: this screen has to fit one phone. */}
            <View style={{ height: ILLUSTRATION_HEIGHT, overflow: 'hidden', alignItems: 'center' }}>
              <Image
                source={FRIENDS}
                accessible={false}
                resizeMode="cover"
                style={{ width: '100%', aspectRatio: 1200 / 614 }}
              />
            </View>

            {/* The invitation. One object: whose group, who is in it, and the
                code to join, then the link under it. */}
            <View
              style={{
                marginTop: -theme.spacing.lg,
                padding: theme.spacing.md,
                borderRadius: theme.radius.xl,
                backgroundColor: theme.color.surface,
                ...theme.shadow.soft,
              }}
            >
              {/* The part that is captured for "Share invite". The members pill
                  and the link row are outside it: an image of a button and a
                  copy control would be dead weight in a chat. */}
              <View
                ref={inviteCardRef}
                collapsable={false}
                style={{ backgroundColor: theme.color.surface, gap: theme.spacing.sm }}
              >
                <Row style={{ gap: theme.spacing.md, paddingEnd: PILL_RESERVE }}>
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: theme.color.brandSoft,
                    }}
                  >
                    <Ionicons
                      name={TYPE_ICON[group.data?.type ?? ''] ?? 'people'}
                      size={iconSize.xl}
                      color={theme.color.brand}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="subheading" numberOfLines={1}>
                      {label}
                    </Text>
                    {present.length > 0 ? (
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {plural(locale, present.length, t.people.inviteMembersHere)}
                      </Text>
                    ) : null}
                  </View>
                </Row>

                {faces.length > 0 ? (
                  // Overlapped with a negative *start* margin rather than a left
                  // one, so the stack falls the right way round in Arabic.
                  <Row>
                    {faces.map((member, index) => (
                      <View
                        key={member.id}
                        style={{
                          marginStart: index === 0 ? 0 : -8,
                          borderRadius: 999,
                          borderWidth: 2,
                          borderColor: theme.color.surface,
                        }}
                      >
                        <Avatar
                          name={displayName(member, profile?.id, null, t.misc.someone)}
                          ghost={isGhost(member)}
                          size={28}
                        />
                      </View>
                    ))}
                    {overflow > 0 ? (
                      <View
                        style={{
                          marginStart: -8,
                          width: 32,
                          height: 32,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderStyle: 'dashed',
                          borderColor: theme.color.brand,
                          backgroundColor: theme.color.brandSoft,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text variant="micro" style={{ color: theme.color.brand }}>
                          {`+${overflow}`}
                        </Text>
                      </View>
                    ) : null}
                  </Row>
                ) : null}

                <View
                  style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.color.border }}
                />

                {/* The code sits on its own white plate whatever the theme is
                    doing: a QR on a dark ground does not scan. The brackets are
                    the brand's frame round it; they sit outside the plate, in
                    the wrapper's padding, so they never cover a module. */}
                <View style={{ alignSelf: 'center', padding: BRACKET_GAP }}>
                  <View style={{ backgroundColor: '#ffffff', borderRadius: theme.radius.sm }}>
                    <QRCodeStyled
                      data={link}
                      size={QR_SIZE}
                      padding={8}
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
                        padding: 4,
                        hidePieces: true,
                      }}
                    />
                  </View>
                  <Bracket corner="top-start" color={theme.color.brand} />
                  <Bracket corner="top-end" color={theme.color.brand} />
                  <Bracket corner="bottom-start" color={theme.color.brand} />
                  <Bracket corner="bottom-end" color={theme.color.brand} />
                </View>

                <Text variant="caption" align="center">
                  {fill(t.people.scanToJoinType, { type: typeWord })}
                </Text>
              </View>

              {/* Opens the members screen. Over the card's corner rather than in
                  the captured row, and pinned to the end so it mirrors in RTL. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={plural(locale, present.length, t.people.inviteMembersPill)}
                onPress={() => router.push(`/group/${groupId}/members`)}
                style={({ pressed }) => ({
                  position: 'absolute',
                  top: theme.spacing.md,
                  end: theme.spacing.md,
                  height: 36,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                  paddingHorizontal: theme.spacing.sm,
                  borderRadius: 999,
                  backgroundColor: theme.color.brandSoft,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name="people" size={iconSize.md} color={theme.color.brand} />
                <Text variant="caption" style={{ color: theme.color.brand }} numberOfLines={1}>
                  {plural(locale, present.length, t.people.inviteMembersPill)}
                </Text>
                <Ionicons
                  name={directionalIcon('chevron-forward')}
                  size={iconSize.sm}
                  color={theme.color.brand}
                />
              </Pressable>

              {/* The link, with copying on it rather than beside it. Copy used to
                  be a fifth circle on the channel row, which put the act of
                  taking the link somewhere other than the link itself. */}
              <Row
                style={{
                  gap: theme.spacing.sm,
                  marginTop: theme.spacing.sm,
                  paddingStart: theme.spacing.md,
                  paddingVertical: theme.spacing.xs,
                  paddingEnd: theme.spacing.xs,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.color.surfaceMuted,
                }}
              >
                <Ionicons name="link" size={iconSize.md} color={theme.color.brand} />
                <Text
                  variant="caption"
                  style={{ flex: 1 }}
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
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: 999,
                    backgroundColor: theme.color.brandSoft,
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
            </View>

            {/* "Share via": the quick roads. Each one opens an app with the link
                already written; a named channel beats the OS sheet when you
                already know where this person lives. */}
            <Row style={{ gap: theme.spacing.md, marginTop: theme.spacing.xs }}>
              <View
                style={{
                  flex: 1,
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: theme.color.border,
                }}
              />
              <Text variant="caption" tone="muted">
                {t.people.shareVia}
              </Text>
              <View
                style={{
                  flex: 1,
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: theme.color.border,
                }}
              />
            </Row>
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
                    gap: 2,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  {/* An explicit square. `width: '100%'` with `aspectRatio`
                      resolved against the column and came out a tall oval on a
                      real screen; a circle is one number, not a proportion. */}
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: option.color,
                    }}
                  >
                    <Ionicons name={option.icon} size={iconSize.xl} color="#ffffff" />
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
              variant="brand"
              fullWidth
              icon={<Ionicons name="share-social" size={iconSize.lg} color={theme.color.onBrand} />}
              onPress={() => void shareCard(share)}
            />

            {/* Said once, at the bottom, naming the group it lets people into —
                a warning is only useful if it says what is being opened. */}
            <Text variant="micro" tone="muted" align="center" numberOfLines={2}>
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

/**
 * One corner of the frame round the QR. Border start/end rather than left/right,
 * so the pair mirrors in Arabic (the frame is symmetric, but the habit holds).
 */
function Bracket({
  corner,
  color,
}: {
  corner: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
  color: string;
}) {
  const top = corner.startsWith('top');
  const start = corner.endsWith('start');
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        ...(top ? { top: 0 } : { bottom: 0 }),
        ...(start ? { start: 0 } : { end: 0 }),
        width: 22,
        height: 22,
        borderColor: color,
        ...(top ? { borderTopWidth: 3 } : { borderBottomWidth: 3 }),
        ...(start ? { borderStartWidth: 3 } : { borderEndWidth: 3 }),
        ...(top && start ? { borderTopStartRadius: 10 } : null),
        ...(top && !start ? { borderTopEndRadius: 10 } : null),
        ...(!top && start ? { borderBottomStartRadius: 10 } : null),
        ...(!top && !start ? { borderBottomEndRadius: 10 } : null),
      }}
    />
  );
}
