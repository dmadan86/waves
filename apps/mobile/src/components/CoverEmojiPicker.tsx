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
 * drawing that value, not a replacement for it.
 *
 * Two ways to open the grid. Left to itself `CoverEmojiPicker` renders its own
 * trigger and owns the open state — that is the new-group screen, where the
 * only thing to choose is the mark. `GroupCoverSheet` is the fuller version for
 * an existing group, where the cover can also be a photo: one sheet with two
 * panes, so tapping the group's mark reaches every way of changing it without
 * stacking a second modal on top of the first.
 */

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { Button, ListRow, Row, Sheet, Text, directionalIcon, iconSize, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

import { EMOJI_FOR_MARK, GROUP_MARK_IDS, GroupMark, markForEmoji } from './GroupMark';
import type { PhotoGateStatus } from '@/lib/groupPhotoGate';

/** The tile a mark is drawn in, and the label under it. */
const TILE_WIDTH = 72;

/**
 * The grid itself, with no surface of its own, so both the plain picker and the
 * two-pane cover sheet can put it wherever they need it.
 *
 * Selection is stated three ways: the ring and fill that mark the tile, a tick
 * in its corner, and `accessibilityState.selected` on a radio — the last is the
 * one a screen reader actually reads, and colour alone would tell it nothing.
 */
function MarkGrid({ value, onPick }: { value: string | null; onPick: (emoji: string) => void }) {
  const theme = useTheme();
  const { t } = useStrings();
  const current = markForEmoji(value);

  return (
    <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm, justifyContent: 'center' }}>
      {GROUP_MARK_IDS.map((id) => {
        const selected = current === id;
        return (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t.groupMarks[id]}
            onPress={() => onPick(EMOJI_FOR_MARK[id])}
            style={({ pressed }) => ({
              width: TILE_WIDTH,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.radius.lg,
              alignItems: 'center',
              gap: 2,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? theme.color.brand : theme.color.border,
              backgroundColor: selected ? theme.color.brandSoft : theme.color.surfaceMuted,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <GroupMark emoji={EMOJI_FOR_MARK[id]} size={28} />
            <Text variant="micro" tone={selected ? 'brand' : 'muted'} numberOfLines={1}>
              {t.groupMarks[id]}
            </Text>
            {selected ? (
              // `right` is mirrored for an RTL layout by React Native itself,
              // so the tick follows the corner the reading eye ends on.
              <View style={{ position: 'absolute', top: 2, right: 2 }}>
                <Ionicons name="checkmark-circle" size={iconSize.sm} color={theme.color.brand} />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </Row>
  );
}

/** The current pick, shown large enough to judge before the grid below it. */
function CoverPreview({ value }: { value: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: theme.spacing.lg }}>
      <View
        style={{
          width: 84,
          height: 84,
          borderRadius: 28,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <GroupMark emoji={value} size={48} />
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
  compact = false,
  open,
  onOpenChange,
}: {
  value: string | null;
  onChange: (emoji: string) => void;
  /** A small mark-swatch pill instead of a full button, for tight layouts. */
  compact?: boolean;
  /** Controlled open state. When set, no trigger is rendered. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [internalOpen, setInternalOpen] = useState(false);

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
          onPress={() => setOpen(true)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            gap: 6,
            height: 32,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.surfaceMuted,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <GroupMark emoji={value} size={18} />
          <Text variant="caption" tone="muted">
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
        style={{ maxHeight: '82%' }}
      >
        <SheetHeader title={t.group.chooseIcon} onClose={() => setOpen(false)} />
        <CoverPreview value={value} />
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: theme.spacing.xl,
          }}
          showsVerticalScrollIndicator={false}
        >
          <MarkGrid
            value={value}
            onPick={(emoji) => {
              onChange(emoji);
              setOpen(false);
            }}
          />
        </ScrollView>
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
 * The photo half stays gated exactly as it was (a photo is a Plus feature, an
 * icon is free): when the gate is locked the row says so and leads to the
 * upgrade screen instead of the camera roll, and while the answer is still in
 * flight the row is disabled rather than acting on a guess.
 */
export function GroupCoverSheet({
  visible,
  onClose,
  value,
  onChange,
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
      style={{ maxHeight: '82%' }}
    >
      <SheetHeader
        title={showGrid ? t.group.chooseIcon : t.group.changeCover}
        onBack={showGrid ? () => setShowGrid(false) : undefined}
        onClose={close}
      />
      <CoverPreview value={value} />

      {showGrid ? (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: theme.spacing.xl,
          }}
          showsVerticalScrollIndicator={false}
        >
          <MarkGrid
            value={value}
            onPick={(emoji) => {
              onChange(emoji);
              close();
            }}
          />
        </ScrollView>
      ) : (
        <View style={{ paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.xl }}>
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
