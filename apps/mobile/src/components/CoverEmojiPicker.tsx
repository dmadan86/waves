/**
 * Picking the little mark a group wears.
 *
 * This control has been through three shapes. It started as nine emoji crammed
 * under the name field with no way to reach a tenth; it became a bottom sheet
 * holding a curated emoji set, grouped so the eye could find the row it wanted;
 * and it is now a grid of *drawn* marks (see `GroupMark`), because an emoji
 * rendered as text never belonged beside the app's own iconography — see that
 * file for why.
 *
 * What is stored has not changed at any point: the pick is written to
 * `groups.cover_emoji` as a single emoji, which is what the web client, the
 * export and every older build already know how to read. A mark is a way of
 * drawing that value, not a replacement for it. Since then the sheet also
 * offers a few hundred more icons in nine labelled categories (drawn marks
 * first, the rest as the emoji itself) and a colour for the tile behind the
 * icon, stored beside it as `groups.cover_color` (a palette key, see
 * `@waves/core` `GROUP_COVER_COLORS`).
 *
 * One sheet, one decision at a time: tap an icon, tap a colour, Done. Both taps
 * only change a preview at the top; nothing is written until Done, and closing
 * the sheet any other way leaves the group as it was.
 *
 * Two ways to open the grid. Left to itself `CoverEmojiPicker` renders its own
 * trigger and owns the open state — that is the new-group screen, where the
 * only thing to choose is the mark. `GroupCoverSheet` is the fuller version for
 * an existing group, where the cover can also be a photo: one sheet with two
 * panes, so tapping the group's mark reaches every way of changing it without
 * stacking a second modal on top of the first.
 */

import { useMemo, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';

import { GROUP_COVER_COLORS } from '@waves/core';
import { Button, ListRow, Row, Sheet, Text, directionalIcon, iconSize, useTheme } from '@waves/ui';

import { SectionHeader } from '@/components/standard';
import { useStrings } from '@/i18n';

import { GroupMark, markForEmoji } from './GroupMark';
import {
  GROUP_ICON_CATALOG,
  GROUP_ICON_CATEGORY_IDS,
  filterGroupIcons,
} from '@/lib/groupIconCatalog';
import { coverTone, planCoverCommit, useCoverTile } from '@/lib/groupCoverColor';
import { COVER_SWATCHES } from '@/lib/groupCoverTone';
import { QUICK_ICONS, quickIconFor } from '@/lib/groupCoverQuick';
import type { PhotoGateStatus } from '@/lib/groupPhotoGate';

/** An icon tile, and a colour swatch. Both above the 44pt touch size once padded by the gaps. */
const ICON_TILE = 48;
const SWATCH = 36;

/** The current pick on its colour, large enough to judge before choosing more. */
function CoverPreview({ value, color }: { value: string | null; color: string | null }) {
  const theme = useTheme();
  const tile = useCoverTile(color, theme.color.brandSoft);
  return (
    <View style={{ alignItems: 'center', paddingVertical: theme.spacing.md }}>
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 26,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tile.backgroundColor,
        }}
      >
        <GroupMark emoji={value} size={42} color={tile.ink} />
      </View>
    </View>
  );
}

/**
 * The colour row: the app's own colour first (which is also "no choice made"),
 * then the palette. Selection is a ring and a tick, with `selected` on a radio
 * for a screen reader — the swatch colour alone tells it nothing.
 */
function ColourRow({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (key: string | null) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const labels = t.groupIconPicker;

  const swatch = (key: string | null) => {
    const tone = coverTone(key, theme);
    const selected = (value ?? null) === key;
    const label =
      key === null ? labels.defaultColour : labels.colours[key as keyof typeof labels.colours];
    return (
      <Pressable
        key={key ?? 'default'}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
        hitSlop={4}
        onPress={() => onPick(key)}
        style={({ pressed }) => ({
          width: SWATCH,
          height: SWATCH,
          borderRadius: SWATCH / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tone ? tone.bg : theme.color.brandSoft,
          borderWidth: selected ? 3 : 1,
          borderColor: selected ? theme.color.brand : theme.color.border,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {selected ? (
          <Ionicons
            name="checkmark"
            size={iconSize.sm}
            color={tone ? tone.ink : theme.color.brand}
          />
        ) : key === null ? (
          <Ionicons name="close" size={iconSize.sm} color={theme.color.textFaint} />
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={{ gap: theme.spacing.xs, paddingHorizontal: theme.spacing.xl }}>
      <Text variant="caption" tone="muted">
        {labels.colour}
      </Text>
      <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {swatch(null)}
        {GROUP_COVER_COLORS.map((key) => swatch(key))}
      </Row>
    </View>
  );
}

/**
 * Search box and the categorised grid. Selection is stated three ways, as it
 * always was: ring and fill, a tick in the corner, and `selected` on a radio.
 */
function IconGrid({ value, onPick }: { value: string | null; onPick: (emoji: string) => void }) {
  const theme = useTheme();
  const { t } = useStrings();
  const labels = t.groupIconPicker;
  const [query, setQuery] = useState('');
  const current = markForEmoji(value);

  const sections = useMemo(
    () =>
      GROUP_ICON_CATEGORY_IDS.map((id) => {
        const heading = labels.categories[id];
        // A search that names the category ("food") shows all of it.
        const nameHit =
          query.trim() !== '' &&
          heading.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
        const entries = nameHit
          ? GROUP_ICON_CATALOG[id]
          : filterGroupIcons(GROUP_ICON_CATALOG[id], query, (entry) => {
              const mark = markForEmoji(entry.emoji);
              return mark ? t.groupMarks[mark] : '';
            });
        return { id, heading, entries };
      }).filter((section) => section.entries.length > 0),
    [query, labels.categories, t.groupMarks],
  );

  return (
    <View style={{ flex: 1, gap: theme.spacing.sm }}>
      <Row
        style={{
          alignItems: 'center',
          gap: theme.spacing.md,
          height: 44,
          marginHorizontal: theme.spacing.xl,
          paddingHorizontal: theme.spacing.lg,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.color.surfaceMuted,
        }}
      >
        <Ionicons name="search" size={iconSize.md} color={theme.color.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={labels.searchPlaceholder}
          placeholderTextColor={theme.color.textMuted}
          accessibilityLabel={labels.searchPlaceholder}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={{ flex: 1, fontSize: 15, color: theme.color.text, paddingVertical: 0 }}
        />
      </Row>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {sections.length === 0 ? (
          <Text tone="muted" style={{ textAlign: 'center', paddingVertical: theme.spacing.xl }}>
            {labels.noMatches}
          </Text>
        ) : null}
        {sections.map(({ id, heading, entries }) => (
          <View key={id} style={{ gap: theme.spacing.sm }}>
            <Text variant="caption" tone="muted" accessibilityRole="header">
              {heading}
            </Text>
            <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {entries.map((entry) => {
                const mark = markForEmoji(entry.emoji);
                const selected = mark ? current === mark : value === entry.emoji;
                return (
                  <Pressable
                    key={entry.emoji}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={mark ? t.groupMarks[mark] : entry.keywords.split(' ')[0]}
                    onPress={() => onPick(entry.emoji)}
                    style={({ pressed }) => ({
                      width: ICON_TILE,
                      height: ICON_TILE,
                      borderRadius: theme.radius.lg,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? theme.color.brand : theme.color.border,
                      backgroundColor: selected ? theme.color.brandSoft : theme.color.surfaceMuted,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <GroupMark emoji={entry.emoji} size={26} />
                  </Pressable>
                );
              })}
            </Row>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * The whole editor, shared by the plain picker and the cover sheet: preview,
 * colours, search and grid, and the one Done button. The icon and colour are
 * drafts held here and handed back together, so nothing is written (and
 * nothing is queued to sync) until Done.
 */
function IconColourEditor({
  visible,
  icon,
  color,
  onDone,
}: {
  visible: boolean;
  icon: string | null;
  color: string | null;
  onDone: (icon: string | null, color: string | null) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [draftIcon, setDraftIcon] = useState(icon);
  const [draftColor, setDraftColor] = useState(color);

  // Always open on what the group has now, not on a half-made change the sheet
  // was dismissed with last time.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setDraftIcon(icon);
      setDraftColor(color);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <CoverPreview value={draftIcon} color={draftColor} />
      <ColourRow value={draftColor} onPick={setDraftColor} />
      <View style={{ height: theme.spacing.md }} />
      <IconGrid value={draftIcon} onPick={setDraftIcon} />
      <View style={{ paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md }}>
        <Button label={t.common.done} onPress={() => onDone(draftIcon, draftColor)} />
      </View>
    </View>
  );
}

/** The sheet's own title bar, with an optional way back to the pane before it. */
function SheetHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack?: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Row
      style={{
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: theme.spacing.xl,
        gap: theme.spacing.sm,
      }}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm, flex: 1 }}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.back}
            onPress={onBack}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Ionicons
              name={directionalIcon('chevron-back')}
              size={iconSize.lg}
              color={theme.color.textMuted}
            />
          </Pressable>
        ) : null}
        <Text variant="heading">{title}</Text>
      </Row>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.common.close}
        onPress={onClose}
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
      >
        <Ionicons name="close" size={iconSize.lg} color={theme.color.textMuted} />
      </Pressable>
    </Row>
  );
}

export function CoverEmojiPicker({
  value,
  onChange,
  color = null,
  onColorChange,
  compact = false,
  open,
  onOpenChange,
}: {
  value: string | null;
  onChange: (emoji: string) => void;
  /** The colour behind the icon (a `GROUP_COVER_COLORS` key), or null for the app's own. */
  color?: string | null;
  /** Called on Done when the colour changed; null goes back to the app's own. */
  onColorChange?: (color: string | null) => void;
  /** A small mark-swatch pill instead of a full button, for tight layouts. */
  compact?: boolean;
  /** Controlled open state. When set, no trigger is rendered. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [internalOpen, setInternalOpen] = useState(false);
  const pill = useCoverTile(color, theme.color.surfaceMuted);

  const controlled = open !== undefined;
  const isOpen = controlled ? open : internalOpen;
  const setOpen = (next: boolean): void => {
    if (controlled) onOpenChange?.(next);
    else setInternalOpen(next);
  };

  return (
    <>
      {controlled ? null : compact ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.group.chooseIcon}
          // 32 tall; the slop takes the touch to 44.
          hitSlop={{ top: 6, bottom: 6 }}
          onPress={() => setOpen(true)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            gap: 6,
            height: 32,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.pill,
            backgroundColor: pill.backgroundColor,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <GroupMark emoji={value} size={18} color={pill.ink} />
          <Text variant="caption" tone="muted" style={pill.ink ? { color: pill.ink } : undefined}>
            {t.group.chooseIcon}
          </Text>
        </Pressable>
      ) : (
        <Button
          label={t.group.chooseIcon}
          size="sm"
          variant="secondary"
          onPress={() => setOpen(true)}
        />
      )}

      <Sheet
        visible={isOpen}
        onClose={() => setOpen(false)}
        padded={false}
        closeLabel={t.common.close}
        style={{ height: '90%' }}
      >
        <SheetHeader title={t.group.chooseIcon} onClose={() => setOpen(false)} />
        <IconColourEditor
          visible={isOpen}
          icon={value}
          color={color}
          onDone={(nextIcon, nextColor) => {
            const plan = planCoverCommit(
              { icon: value, color },
              { icon: nextIcon, color: nextColor },
            );
            if (plan.icon) onChange(plan.icon);
            if ('color' in plan) onColorChange?.(plan.color ?? null);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}

/** The quick icons' own tile: its colour at a low alpha, so one rule serves both schemes. */
function quickTileBackground(hex: string, dark: boolean): string {
  return `${hex}${dark ? '38' : '24'}`;
}

/** Step 1: the ten everyday icons in a 5 × 2 grid, each on its own soft tint. */
function QuickIconGrid({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (emoji: string) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const dark = theme.scheme === 'dark';
  const current = quickIconFor(value);
  // Five to a row, measured: a percentage width inside the padded sheet came out
  // at four, pushing Game and Other onto a third row.
  const [width, setWidth] = useState(0);
  const cell = Math.floor(width / 5);
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: theme.spacing.md }}
    >
      {QUICK_ICONS.map((quick) => {
        const selected = current === quick.id;
        const label = t.groupIconPicker.quick[quick.id];
        return (
          <Pressable
            key={quick.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            onPress={() => onPick(quick.emoji)}
            style={({ pressed }) => ({
              width: cell || '20%',
              alignItems: 'center',
              gap: 6,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 58,
                height: 58,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: quickTileBackground(quick.color, dark),
                borderWidth: 2,
                borderColor: selected ? theme.color.brand : 'transparent',
              }}
            >
              {/* The very mark the cover is drawn with everywhere else. */}
              <GroupMark emoji={quick.emoji} size={32} color={quick.color} />
            </View>
            <Text
              variant="caption"
              numberOfLines={1}
              style={{
                color: selected ? theme.color.brand : theme.color.textMuted,
                fontWeight: selected ? '700' : '400',
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Step 2: eight solid circles; the picked one carries a tick inside a ring. */
function SwatchRow({ value, onPick }: { value: string | null; onPick: (key: string) => void }) {
  const { t } = useStrings();
  // A group with no colour chosen is drawn on the app's own tile, which is the
  // indigo family; show that one as the current pick.
  const current = value ?? 'iris';
  // Sized from the measured row so all eight fit down to 360dp.
  const [width, setWidth] = useState(0);
  const slot = width > 0 ? Math.min(44, Math.floor(width / COVER_SWATCHES.length)) : 40;
  const dot = slot - 8;
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ flexDirection: 'row', justifyContent: 'space-between' }}
    >
      {COVER_SWATCHES.map((swatch) => {
        const selected = current === swatch.key;
        return (
          <Pressable
            key={swatch.key}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={
              t.groupIconPicker.colours[swatch.key as keyof typeof t.groupIconPicker.colours]
            }
            onPress={() => onPick(swatch.key)}
            hitSlop={4}
            style={{
              width: slot,
              height: slot,
              borderRadius: slot / 2,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: selected ? `${swatch.hex}80` : 'transparent',
            }}
          >
            <View
              style={{
                width: dot,
                height: dot,
                borderRadius: dot / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: swatch.hex,
              }}
            >
              {selected ? <Ionicons name="checkmark" size={20} color="#FFFFFF" /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The current pick on its colour, over a soft cloudy ground, with the group's name. */
function CloudPreview({
  icon,
  color,
  name,
}: {
  icon: string | null;
  color: string | null;
  name: string;
}) {
  const theme = useTheme();
  const tile = useCoverTile(color, theme.color.brandSoft);
  const dark = theme.scheme === 'dark';
  const cloud = dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.7)';
  const blob = dark ? 'rgba(124,111,240,0.16)' : 'rgba(124,111,240,0.12)';
  return (
    <View style={{ borderRadius: 22, overflow: 'hidden' }}>
      <LinearGradient
        colors={dark ? ['#25233F', '#1B1A2E'] : ['#E9E5FF', '#F7F5FF']}
        style={{ alignItems: 'center', paddingTop: 20, paddingBottom: 14, gap: 8 }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: -30,
            top: -30,
            width: 110,
            height: 110,
            borderRadius: 55,
            backgroundColor: blob,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: 44,
            top: 34,
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: blob,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: -20,
            bottom: -34,
            width: 130,
            height: 70,
            borderRadius: 35,
            backgroundColor: cloud,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: -24,
            bottom: -30,
            width: 150,
            height: 80,
            borderRadius: 40,
            backgroundColor: cloud,
          }}
        />
        <View
          style={{
            width: 86,
            height: 86,
            borderRadius: 28,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tile.backgroundColor,
          }}
        >
          <GroupMark emoji={icon} size={48} color={tile.ink} />
        </View>
        <Text
          variant="heading"
          numberOfLines={1}
          style={{ fontSize: 20, fontWeight: '800', paddingHorizontal: theme.spacing.xl }}
        >
          {name}
        </Text>
      </LinearGradient>
    </View>
  );
}

/**
 * Every way of changing an existing group's cover, in ONE sheet: a title and a
 * close button, an "Icon & colour" / "Photo" switch, a preview card, ten quick
 * icons ("See all" opens the full catalogue in place of the body), eight
 * colours, and a Done button pinned under the scrolling part.
 *
 * The icon and colour are drafts held here and written together on Done, so
 * closing any other way changes nothing. The Photo half is the same flow it
 * always was, gate included (a photo is Pro, an icon is free): locked sends to
 * the upgrade screen, and while the answer is still in flight the row is
 * disabled rather than acting on a guess.
 */
export function GroupCoverSheet({
  visible,
  onClose,
  value,
  onChange,
  color = null,
  onColorChange,
  name,
  hasPhoto,
  photoStatus,
  onPickPhoto,
  onRemovePhoto,
  onUpgrade,
}: {
  visible: boolean;
  onClose: () => void;
  value: string | null;
  onChange: (emoji: string) => void;
  /** The colour behind the icon (a `GROUP_COVER_COLORS` key), or null for the app's own. */
  color?: string | null;
  onColorChange?: (color: string | null) => void;
  /** What the preview calls the group. */
  name: string;
  hasPhoto: boolean;
  photoStatus: PhotoGateStatus;
  onPickPhoto: () => void;
  onRemovePhoto: () => void;
  onUpgrade: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { height: windowHeight } = useWindowDimensions();
  const [tab, setTab] = useState<'icon' | 'photo'>('icon');
  const [showAll, setShowAll] = useState(false);
  const [draftIcon, setDraftIcon] = useState(value);
  const [draftColor, setDraftColor] = useState(color);

  // Always open on what the group has now, on the first pane.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setDraftIcon(value);
      setDraftColor(color);
      setTab('icon');
      setShowAll(false);
    }
  }

  const done = (): void => {
    const plan = planCoverCommit({ icon: value, color }, { icon: draftIcon, color: draftColor });
    if (plan.icon) onChange(plan.icon);
    if ('color' in plan) onColorChange?.(plan.color ?? null);
    onClose();
  };

  const chip = (icon: ReactNode, tone: 'brand' | 'danger'): ReactNode => (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: theme.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone === 'danger' ? theme.color.negativeSoft : theme.color.brandSoft,
      }}
    >
      {icon}
    </View>
  );

  const tabs = [
    { id: 'icon' as const, label: t.group.coverTabIcon, icon: 'color-palette' as const },
    { id: 'photo' as const, label: t.group.coverTabPhoto, icon: 'image' as const },
  ];

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      padded={false}
      closeLabel={t.common.close}
      style={{ height: Math.round(windowHeight * 0.92) }}
    >
      {showAll ? (
        <SheetHeader
          title={t.group.chooseIcon}
          onBack={() => setShowAll(false)}
          onClose={onClose}
        />
      ) : (
        <Row
          style={{
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            paddingHorizontal: theme.spacing.xl,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" accessibilityRole="header" style={{ fontSize: 26 }}>
              {t.group.changeCover}
            </Text>
            <Text tone="muted">{t.group.coverSubtitle}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.surfaceMuted,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
          </Pressable>
        </Row>
      )}

      {showAll ? (
        <View style={{ flex: 1, paddingTop: theme.spacing.md }}>
          <IconGrid value={draftIcon} onPick={setDraftIcon} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.xl,
            paddingTop: theme.spacing.lg,
            paddingBottom: theme.spacing.lg,
            gap: theme.spacing.lg,
          }}
          showsVerticalScrollIndicator={false}
        >
          <Row
            accessibilityRole="tablist"
            style={{
              padding: 4,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.surfaceMuted,
            }}
          >
            {tabs.map((entry) => {
              const selected = tab === entry.id;
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setTab(entry.id)}
                  style={{
                    flex: 1,
                    height: 40,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: theme.spacing.sm,
                    borderRadius: theme.radius.pill,
                    backgroundColor: selected ? theme.color.brandSoft : 'transparent',
                  }}
                >
                  <Ionicons
                    name={entry.icon}
                    size={iconSize.base}
                    color={selected ? theme.color.brand : theme.color.textMuted}
                  />
                  <Text
                    style={{
                      fontWeight: '700',
                      color: selected ? theme.color.brand : theme.color.textMuted,
                    }}
                  >
                    {entry.label}
                  </Text>
                </Pressable>
              );
            })}
          </Row>

          <CloudPreview icon={draftIcon} color={draftColor} name={name} />

          {tab === 'icon' ? (
            <>
              <View style={{ gap: theme.spacing.md }}>
                <SectionHeader
                  title={t.group.chooseIconStep}
                  action={{ label: t.group.seeAll, onPress: () => setShowAll(true) }}
                />
                <QuickIconGrid value={draftIcon} onPick={setDraftIcon} />
              </View>
              <View style={{ gap: theme.spacing.md }}>
                <SectionHeader title={t.group.chooseColourStep} />
                <SwatchRow value={draftColor} onPick={setDraftColor} />
              </View>
            </>
          ) : (
            <View>
              <ListRow
                title={hasPhoto ? t.misc.changeGroupPhoto : t.misc.addGroupPhoto}
                subtitle={photoStatus === 'locked' ? t.group.photoIsPaid : t.group.usePhotoHint}
                leading={chip(
                  <Ionicons
                    name={photoStatus === 'locked' ? 'lock-closed-outline' : 'camera-outline'}
                    size={iconSize.lg}
                    color={theme.color.brand}
                  />,
                  'brand',
                )}
                onPress={
                  photoStatus === 'loading'
                    ? undefined
                    : () => {
                        onClose();
                        if (photoStatus === 'locked') onUpgrade();
                        else onPickPhoto();
                      }
                }
              />
              {hasPhoto ? (
                <ListRow
                  title={t.group.removePhoto}
                  subtitle={t.group.removePhotoHint}
                  destructive
                  leading={chip(
                    <Ionicons
                      name="trash-outline"
                      size={iconSize.lg}
                      color={theme.color.negative}
                    />,
                    'danger',
                  )}
                  onPress={() => {
                    onClose();
                    onRemovePhoto();
                  }}
                />
              ) : null}
            </View>
          )}
        </ScrollView>
      )}

      {/* Pinned under the scrolling part, never floating over the grid. */}
      <View style={{ paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md }}>
        <Button label={t.common.done} variant="brand" size="lg" fullWidth onPress={done} />
      </View>
    </Sheet>
  );
}
