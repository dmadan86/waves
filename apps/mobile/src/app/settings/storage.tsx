/**
 * A meter for how much image storage this account has used (A44).
 *
 * Free accounts hold up to a ceiling (`app_config.free_storage_cap_bytes`, 10 MB)
 * of photos and receipts; this shows how close to it they are and routes to the
 * upgrade when it is full. A paid account is uncapped, so it gets a plain
 * "Unlimited" statement rather than a bar that would always read empty.
 *
 * The figure is a live server read (`waves_my_storage_usage`), not the local
 * mirror: byte accounting lives only server-side, where the cap is enforced, so
 * there is nothing on-device to reconcile it against.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Reanimated from 'react-native-reanimated';

import {
  Button,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Skeleton,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { canUploadGroupPhoto, myStorageUsage } from '@/data/api';
import { formatBytes } from '@/lib/bytes';
import { useStrings } from '@/i18n';
import { useCrossfade } from '@/lib/anim';
import { router } from '@/lib/navigation';
import { r2Enabled } from '@/lib/storage';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

type IconName = keyof typeof Ionicons.glyphMap;

export default function StorageUsageScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { dark, ink, muted, accent } = useStorageInks();

  // "Am I paid" over the same SECURITY DEFINER path the photo gate uses
  // (`canUploadGroupPhoto(null)`, A39) — a paid account is uncapped, so the meter
  // becomes an "Unlimited" statement instead of a bar. `undefined` while loading.
  const paid = useQuery({
    queryKey: ['is-paid-storage'],
    queryFn: () => canUploadGroupPhoto(null),
  });
  // If the paid-status read fails outright (no cached answer), fall back to
  // "free" so the screen resolves — otherwise `isPaid` stays undefined forever,
  // the skeleton never exits, and the usage query below is left disabled. Free is
  // the safe default: the meter shows, and the cap is enforced server-side anyway.
  const isPaid = paid.data ?? (paid.isError ? false : undefined);

  // The meter only means anything once storage is on R2, where per-user bytes are
  // tracked; before that there is no tally to show. It is also pointless for a
  // paid account, which is never charged bytes — so the query only runs for a
  // free account with R2 live.
  const shouldMeasure = r2Enabled() && isPaid === false;
  const usage = useQuery({
    queryKey: ['storage-usage'],
    queryFn: myStorageUsage,
    enabled: shouldMeasure,
  });

  const header = (
    <Row style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.xs }}>
      <IconButton label={t.common.back} onPress={() => router.back()}>
        <Ionicons name={directionalIcon('chevron-back')} size={iconSize.lg} color={ink} />
      </IconButton>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: ink }}>{t.storage.title}</Text>
      </View>
      <View style={{ width: 44 }} />
    </Row>
  );

  const body = () => {
    // Paid, or R2 not yet live: no ceiling applies, so state it plainly rather
    // than drawing an empty bar. Still a skeleton's business to stand in for —
    // `isPaid === undefined` falls through to the meter-shaped skeleton below
    // instead of a card of its own, because the common case (a free account)
    // ends on that shape and a skeleton is for what is *likely* coming, not a
    // third shape nobody else on the screen ever shows.
    if (isPaid || (isPaid !== undefined && !r2Enabled())) {
      return (
        <MeterCard>
          <Text style={{ fontSize: 20, fontWeight: '800', color: ink }}>{t.storage.unlimited}</Text>
          <Text style={{ fontSize: 12, lineHeight: 16, color: muted }}>
            {t.storage.unlimitedBody}
          </Text>
        </MeterCard>
      );
    }

    // A failed read must not sit as a skeleton forever — offer a retry. But a
    // refetch that fails while an earlier read still holds data keeps showing the
    // (stale) meter rather than blanking it: only a failure with nothing cached
    // becomes the error card.
    if (usage.isError && !usage.data) {
      return (
        <Card style={{ gap: theme.spacing.sm }}>
          <Text variant="subheading">{t.loadError}</Text>
          <Text variant="body" tone="muted">
            {t.loadErrorBody}
          </Text>
          <Button label={t.retry} fullWidth onPress={() => usage.refetch()} />
        </Card>
      );
    }

    // `isPaid === undefined` (still checking who pays) and `usage.isLoading`
    // (checking the bytes) both land here, in the exact shape the free loaded
    // screen below renders — meter card, then perks card — so there is nothing
    // to swap when either resolves, only values inside that shape to reveal.
    const ready = isPaid === false && !usage.isLoading && !!usage.data;
    const data = usage.data;
    const fraction = data && data.capBytes > 0 ? data.usedBytes / data.capBytes : 0;
    const percent = Math.min(100, Math.round(fraction * 100));
    const full = Boolean(data && data.usedBytes >= data.capBytes && data.capBytes > 0);
    const fill = full ? theme.color.negative : accent;

    return (
      <>
        <MeterCard
          note={
            ready && data ? (
              full ? (
                t.storage.full
              ) : (
                t.storage.freeBody.replace('{cap}', formatBytes(data.capBytes, locale))
              )
            ) : (
              <Skeleton width="70%" height={12} />
            )
          }
          alarm={ready && full}
        >
          <MeterValues
            ready={ready}
            usedBytes={data?.usedBytes ?? 0}
            capBytes={data?.capBytes ?? 0}
            percent={percent}
            full={full}
            fill={fill}
          />
        </MeterCard>

        <SoftCard>
          <Text style={{ fontSize: 15, fontWeight: '800', color: ink }}>
            {t.storage.perksTitle}
          </Text>
          <Perk
            icon="infinite"
            fg="#6845E8"
            bg="#EFEBFD"
            title={t.storage.perkUnlimited}
            sub={t.storage.perkUnlimitedSub}
          />
          <Perk
            icon="cloud-upload-outline"
            fg="#2F6FE4"
            bg="#E7F0FE"
            title={t.storage.perkBackup}
            sub={t.storage.perkBackupSub}
          />
          <Perk
            icon="star-outline"
            fg="#F29A1F"
            bg="#FFF1E0"
            title={t.storage.perkDevices}
            sub={t.storage.perkDevicesSub}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.storage.upgrade}
            onPress={() => router.push('/settings/upgrade')}
            style={({ pressed }) => ({ marginTop: theme.spacing.xs, opacity: pressed ? 0.88 : 1 })}
          >
            <LinearGradient
              colors={dark ? [theme.color.brand, theme.color.brand] : ['#5A3FD8', '#7A5CF5']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                // The standard button height (and this screen's 44pt floor
                // for anything tappable) — the old 50pt disc read as a hero
                // action this screen doesn't have room for any more.
                height: 44,
                borderRadius: 22,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: theme.spacing.sm,
              }}
            >
              <Ionicons name="rocket-outline" size={18} color="#FFFFFF" />
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
                {t.storage.upgrade}
              </Text>
            </LinearGradient>
          </Pressable>
        </SoftCard>
      </>
    );
  };

  return (
    <Screen>
      {header}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          paddingTop: theme.spacing.xs,
          // Tight enough that the meter card and the perks card both read as
          // one screen rather than a scroll — see the density note on
          // `MeterCard` and `SoftCard` below.
          gap: theme.spacing.sm,
        }}
        showsVerticalScrollIndicator={false}
      >
        {body()}
      </ScrollView>
    </Screen>
  );
}

/** The mockup's inks in the light theme; the theme's own in the dark. */
function useStorageInks() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return {
    dark,
    ink: dark ? theme.color.text : SPEC_INK,
    muted: dark ? theme.color.textMuted : SPEC_MUTED,
    accent: dark ? theme.color.brand : SPEC_ACCENT,
    lavender: dark ? theme.color.surfaceMuted : '#F1EFFC',
  };
}

/** A white card with the redesign's soft corners and lift. */
function SoftCard({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        gap: theme.spacing.sm,
        shadowColor: '#2A1E6B',
        shadowOpacity: theme.scheme === 'dark' ? 0 : 0.06,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      }}
    >
      {children}
    </View>
  );
}

/** The top card: the "Storage used" label over the figures on the left, the
 *  folder picture on the right, and the free-tier note on a lavender band. */
function MeterCard({
  children,
  note,
  alarm,
}: {
  children: ReactNode;
  /**
   * A string renders in the free-tier note's own colour (muted, or alarm red
   * when full); anything else — the loading skeleton's placeholder line — is
   * rendered as given, since a grey bar has no "alarm" colour to carry. Either
   * way the icon and lavender band around it are real from the first frame:
   * only the sentence inside is ever in question.
   */
  note?: ReactNode;
  alarm?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { dark, muted, accent, lavender } = useStorageInks();
  return (
    <LinearGradient
      colors={dark ? [theme.color.surface, theme.color.surface] : ['#FFFFFF', '#F6F4FE']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        gap: theme.spacing.sm,
        overflow: 'hidden',
      }}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.xs }}>
          <Text style={{ fontSize: 12, fontWeight: '600', letterSpacing: 0.6, color: muted }}>
            {t.storage.usedLabel.toLocaleUpperCase()}
          </Text>
          {children}
        </View>
        <FolderArt size={56} />
      </Row>
      {note ? (
        <Row
          style={{
            alignItems: 'center',
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.xs,
            borderRadius: theme.radius.sm,
            backgroundColor: lavender,
          }}
        >
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={alarm ? theme.color.negative : accent}
          />
          <View style={{ flex: 1 }}>
            {typeof note === 'string' ? (
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 12,
                  color: alarm ? theme.color.negative : muted,
                }}
              >
                {note}
              </Text>
            ) : (
              note
            )}
          </View>
        </Row>
      ) : null}
    </LinearGradient>
  );
}

/**
 * `MeterCard`'s figures: the used-of-cap/percent row and the bar beneath it —
 * the data-dependent pieces the loading state has to stand in for. Compacted
 * onto one row ("7.2 MB of 10 MB" beside "72% used") and a 6pt bar, rather
 * than the three stacked lines this used to take — the same figures, in the
 * height a single list row would cost elsewhere in the app.
 *
 * Both faces stay mounted across the swap: a skeleton-shaped placeholder in
 * the normal flow (which is what gives this block its height before any data
 * exists) and the real figures laid over it once they arrive, each carrying
 * half of a 180ms opacity crossfade (`useCrossfade`) so the numbers dissolve
 * into place rather than popping in. The placeholder's own height and the
 * bar's own height and radius match the real ones exactly, so nothing about
 * the card's box changes size when the swap happens — only what is drawn
 * inside it.
 */
function MeterValues({
  ready,
  usedBytes,
  capBytes,
  percent,
  full,
  fill,
}: {
  ready: boolean;
  usedBytes: number;
  capBytes: number;
  percent: number;
  full: boolean;
  fill: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { dark, ink, muted } = useStorageInks();
  const reveal = useCrossfade(ready);

  return (
    <View
      accessible={!ready}
      accessibilityRole={ready ? undefined : 'progressbar'}
      accessibilityLabel={ready ? undefined : t.common.loading}
    >
      <Reanimated.View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        style={[{ gap: theme.spacing.xs }, reveal.fromStyle]}
      >
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Skeleton width="55%" height={18} animated={!ready} />
          <Skeleton width={36} height={12} animated={!ready} />
        </Row>
        <Skeleton width="100%" height={6} radius={3} animated={!ready} />
      </Reanimated.View>
      {ready ? (
        <Reanimated.View
          style={[StyleSheet.absoluteFill, { gap: theme.spacing.xs }, reveal.toStyle]}
        >
          {/* Used-of-cap and the percent now share one row — the two used to
              stack as their own lines, which is most of what made this card
              tall. */}
          <Row style={{ alignItems: 'baseline', gap: theme.spacing.sm }}>
            <Text
              style={{ flex: 1, fontSize: 18, fontWeight: '800', color: ink }}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {t.storage.usedOfCap
                .replace('{used}', formatBytes(usedBytes, locale))
                .replace('{cap}', formatBytes(capBytes, locale))}
            </Text>
            <Text
              style={{
                fontSize: 12,
                fontWeight: '700',
                color: full ? theme.color.negative : muted,
              }}
              numberOfLines={1}
            >
              {t.storage.percentUsed.replace('{percent}', String(percent))}
            </Text>
          </Row>
          {/* The bar, slimmed to 6pt. A flex row so the fill grows from the
              writing start — left in LTR, right in RTL — without any manual
              direction handling. */}
          <View
            style={{
              flexDirection: 'row',
              height: 6,
              borderRadius: 3,
              backgroundColor: dark ? theme.color.surfaceMuted : '#ECEAF4',
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.max(percent, usedBytes > 0 ? 4 : 0)}%`,
                backgroundColor: fill,
                borderRadius: 3,
              }}
            />
          </View>
        </Reanimated.View>
      ) : null}
    </View>
  );
}

/**
 * One thing an upgrade brings: a tinted disc, a title and a line.
 *
 * Not a tappable row — just three facts in a list — so it carries none of the
 * 44pt touch-target floor the upgrade button below it does, and can run as
 * tight as `SettingsSection`'s own rows: a smaller disc (32pt, an 18pt glyph,
 * the same `iconSize.md` the rest of the app's list rows draw at), a tighter
 * gap to the text, and both lines capped to one so three perks plus the
 * button fit without the card growing past a phone's fold.
 */
function Perk({
  icon,
  fg,
  bg,
  title,
  sub,
}: {
  icon: IconName;
  fg: string;
  bg: string;
  title: string;
  sub: string;
}) {
  const theme = useTheme();
  const { dark, ink, muted } = useStorageInks();
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: dark ? theme.color.surfaceMuted : bg,
        }}
      >
        <Ionicons name={icon} size={iconSize.md} color={fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: ink }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ fontSize: 12, color: muted }} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </Row>
  );
}

/** The meter's picture: a photo and a receipt tucked into a folder, a cloud
 *  above, two leaves. Drawn from views and glyphs, so it themes and costs no
 *  asset, at its native 108×110 — `size` scales that whole drawing down
 *  (via `transform`, centred in the box it reserves) rather than re-tuning
 *  every coordinate by hand, which is how the compact meter card fits this
 *  picture into a corner instead of a card's worth of its own height. */
function FolderArt({ size = 108 }: { size?: number }) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const folder = dark ? '#4A4290' : '#C9C2FA';
  const scale = size / 108;
  const height = 110 * scale;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height }}
    >
      <View
        style={{
          position: 'absolute',
          left: (size - 108) / 2,
          top: (height - 110) / 2,
          width: 108,
          height: 110,
          transform: [{ scale }],
        }}
      >
        <FolderArtDrawing dark={dark} folder={folder} theme={theme} />
      </View>
    </View>
  );
}

/** The drawing itself, at its native 108×110 — unchanged from before `size`
 *  existed, just pulled out so `FolderArt` can scale it as one unit. */
function FolderArtDrawing({
  dark,
  folder,
  theme,
}: {
  dark: boolean;
  folder: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <>
      <Ionicons
        name="cloud"
        size={40}
        color={dark ? '#5A6FC8' : '#A9C4FA'}
        style={{ position: 'absolute', right: 2, top: 0 }}
      />
      <Ionicons
        name="leaf"
        size={30}
        color={dark ? '#3F8C7A' : '#5FAE9C'}
        style={{ position: 'absolute', left: 0, bottom: 14, transform: [{ rotate: '-35deg' }] }}
      />
      <Ionicons
        name="leaf"
        size={28}
        color={dark ? '#3F8C7A' : '#5FAE9C'}
        style={{ position: 'absolute', right: 0, bottom: 12, transform: [{ rotate: '30deg' }] }}
      />
      {/* Folder back. */}
      <View
        style={{
          position: 'absolute',
          left: 18,
          bottom: 8,
          width: 70,
          height: 56,
          borderRadius: 10,
          backgroundColor: folder,
        }}
      />
      {/* Photo. */}
      <View
        style={{
          position: 'absolute',
          left: 22,
          top: 30,
          width: 36,
          height: 32,
          borderRadius: 6,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#6F8FF2',
          transform: [{ rotate: '-12deg' }],
        }}
      >
        <Ionicons name="image" size={20} color="#FFFFFF" />
      </View>
      {/* Receipt. */}
      <View
        style={{
          position: 'absolute',
          left: 48,
          top: 24,
          width: 32,
          height: 42,
          borderRadius: 4,
          padding: 6,
          gap: 4,
          backgroundColor: dark ? theme.color.surface : '#FFFFFF',
          transform: [{ rotate: '10deg' }],
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.12,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
          elevation: 2,
        }}
      >
        <View style={{ height: 3, borderRadius: 2, backgroundColor: '#C9C2FA' }} />
        <View style={{ height: 3, width: 14, borderRadius: 2, backgroundColor: '#C9C2FA' }} />
        <View style={{ height: 3, borderRadius: 2, backgroundColor: '#C9C2FA' }} />
      </View>
      {/* Folder front. */}
      <LinearGradient
        colors={dark ? ['#5B52B0', '#4A4290'] : ['#E7E3FD', '#CFC8FA']}
        style={{
          position: 'absolute',
          left: 16,
          bottom: 6,
          width: 74,
          height: 38,
          borderRadius: 10,
        }}
      />
    </>
  );
}
