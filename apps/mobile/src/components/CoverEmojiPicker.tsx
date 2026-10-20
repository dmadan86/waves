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
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { GROUP_COVER_COLORS } from '@waves/core';
import { Button, ListRow, Row, Sheet, Text, directionalIcon, iconSize, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

import { GroupMark, markForEmoji } from './GroupMark';
import {
  GROUP_ICON_CATALOG,
  GROUP_ICON_CATEGORY_IDS,
  filterGroupIcons,
} from '@/lib/groupIconCatalog';
import { coverTone, planCoverCommit, useCoverTile } from '@/lib/groupCoverColor';
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

/**
 * Every way of changing an existing group's cover, behind one tap on the mark
 * itself.
 *
 * Two panes rather than two sheets: a `Modal` opened from inside another
 * `Modal` is a fight with the platform on Android, and swapping the content of
 * the one that is already up says the same thing more simply — the list of
 * ways in, and the grid you reach through it.
 *
 * The photo half stays gated exactly as it was (a photo is a Pro feature, an
 * icon is free): when the gate is locked the row says so and leads to the
 * upgrade screen instead of the camera roll, and while the answer is still in
 * flight the row is disabled rather than acting on a guess.
 */
export function GroupCoverSheet({
  visible,
  onClose,
  value,
  onChange,
  color = null,
  onColorChange,
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
  hasPhoto: boolean;
  photoStatus: PhotoGateStatus;
  onPickPhoto: () => void;
  onRemovePhoto: () => void;
  onUpgrade: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [showGrid, setShowGrid] = useState(false);

  const close = (): void => {
    onClose();
    // Reset to the list of ways in, so the sheet always opens where it did
    // last time rather than wherever it happened to be left.
    setShowGrid(false);
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

  return (
    <Sheet
      visible={visible}
      onClose={close}
      padded={false}
      closeLabel={t.common.close}
      style={showGrid ? { height: '90%' } : { maxHeight: '82%' }}
    >
      <SheetHeader
        title={showGrid ? t.group.chooseIcon : t.group.changeCover}
        onBack={showGrid ? () => setShowGrid(false) : undefined}
        onClose={close}
      />

      {showGrid ? (
        <IconColourEditor
          visible={visible && showGrid}
          icon={value}
          color={color}
          onDone={(nextIcon, nextColor) => {
            const plan = planCoverCommit(
              { icon: value, color },
              { icon: nextIcon, color: nextColor },
            );
            if (plan.icon) onChange(plan.icon);
            if ('color' in plan) onColorChange?.(plan.color ?? null);
            close();
          }}
        />
      ) : (
        <View style={{ paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.xl }}>
          <CoverPreview value={value} color={color} />
          <ListRow
            title={t.group.chooseIcon}
            subtitle={t.group.chooseIconHint}
            leading={chip(<GroupMark emoji={value} size={22} />, 'brand')}
            onPress={() => setShowGrid(true)}
            trailing={
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.md}
                color={theme.color.textFaint}
              />
            }
          />
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
                    close();
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
                <Ionicons name="trash-outline" size={iconSize.lg} color={theme.color.negative} />,
                'danger',
              )}
              onPress={() => {
                close();
                onRemovePhoto();
              }}
            />
          ) : null}
        </View>
      )}
    </Sheet>
  );
}
