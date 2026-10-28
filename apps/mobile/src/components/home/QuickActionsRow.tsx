/**
 * The round-disc quick-action strip shared by Home's balance card and
 * Friends': a small tinted disc over a one-line word, in equal columns,
 * carrying the card's own bottom corners so it can run edge to edge without
 * the card clipping (and losing its shadow). No fill and no rule of its own —
 * the card's landscape runs on under the actions, so the strip reads as part
 * of the card rather than a band cut off from it.
 *
 * Home and Friends only differ in which actions they hand it and which tint
 * the discs wear (Home's brand, Friends' lavender) — the geometry is one
 * component so the two cards' feet read as the same shape.
 */

import type { ReactNode, RefObject } from 'react';
import { Pressable, View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { TourTarget } from '@/lib/tour';

export interface QuickAction {
  key: string;
  label: string;
  glyph: (color: string) => ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  /** Wraps the button in a `TourTarget` with this id, for a coach-mark
   *  anchor — only Home's "add group" and "add expense" tiles use this. */
  tourId?: string;
  /** A count badge on the disc’s corner, including zero. */
  badge?: number;
  badgeColor?: string;
  backgroundColor?: string;
  /** Tile variant only: this tile's own fill and glyph colour (e.g. amber credits). */
  tileColor?: string;
  tileInk?: string;
  accessibilityLabel?: string;
  /** Measured for a menu that has to drop from this tile — only Friends'
   *  "Add people" tile uses this. */
  ref?: RefObject<View | null>;
}

export function QuickActionsRow({
  actions,
  radius,
  discColor,
  iconColor,
  discSize = DISC,
  labelSize,
  rowPadding,
  tile = false,
}: {
  actions: readonly QuickAction[];
  /** The card's corner radius, which the strip's bottom corners follow. */
  radius: number;
  /** The disc's fill. */
  discColor: string;
  /** The glyph's own colour, handed to each action's `glyph`. */
  iconColor: string;
  /** The disc's diameter; Home's own 34dp unless a caller asks smaller. */
  discSize?: number;
  /** The label's font size; the shared `micro` variant's 11 unless a caller
   *  asks a specific size. */
  labelSize?: number;
  /** The strip's own vertical padding; `theme.spacing.sm` unless a caller
   *  asks tighter. */
  rowPadding?: number;
  /** Home's look: equal rounded tiles with the glyph above the label, instead of discs. */
  tile?: boolean;
}) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        borderBottomLeftRadius: radius,
        borderBottomRightRadius: radius,
        paddingVertical: rowPadding ?? theme.spacing.sm,
        paddingHorizontal: tile ? theme.spacing.sm : theme.spacing.xs,
        gap: tile ? theme.spacing.sm : 0,
      }}
    >
      {actions.map((action) => {
        if (tile) {
          const ink = action.tileInk ?? iconColor;
          const body = (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                action.accessibilityLabel ??
                (action.badge != null ? `${action.label} (${action.badge})` : action.label)
              }
              onPress={action.onPress}
              onLongPress={action.onLongPress}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 68,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                paddingHorizontal: 2,
                borderRadius: 16,
                backgroundColor: action.tileColor ?? discColor,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              {action.glyph(ink)}
              <Text
                variant="micro"
                align="center"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={{ maxWidth: '100%', fontWeight: '600', color: ink }}
              >
                {action.label}
              </Text>
              {action.badge != null ? (
                <View
                  accessible={false}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: -6,
                    end: -2,
                    minWidth: 20,
                    height: 20,
                    paddingHorizontal: 4,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: action.badgeColor ?? theme.color.negative,
                  }}
                >
                  <Text variant="micro" style={{ color: '#FFFFFF', fontWeight: '700' }}>
                    {action.badge > 99 ? '99+' : String(action.badge)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
          return (
            <View key={action.key} style={{ flex: 1 }} ref={action.ref} collapsable={false}>
              {action.tourId ? <TourTarget id={action.tourId}>{body}</TourTarget> : body}
            </View>
          );
        }
        const disc = (
          <View
            style={{
              width: discSize,
              height: discSize,
              borderRadius: discSize / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: discColor,
            }}
          >
            {action.glyph(iconColor)}
          </View>
        );
        const button = (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              action.accessibilityLabel ??
              (action.badge != null ? `${action.label} (${action.badge})` : action.label)
            }
            onPress={action.onPress}
            onLongPress={action.onLongPress}
            hitSlop={4}
            style={({ pressed }) => ({
              alignItems: 'center',
              gap: 4,
              alignSelf: 'center',
              maxWidth: '100%',
              paddingHorizontal: 2,
              borderRadius: 16,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {action.backgroundColor ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: -4,
                  bottom: -4,
                  left: -4,
                  right: -4,
                  borderRadius: 16,
                  backgroundColor: action.backgroundColor,
                }}
              />
            ) : null}
            <View>
              {disc}
              {action.badge != null ? (
                <View
                  accessible={false}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    minWidth: 18,
                    height: 18,
                    paddingHorizontal: 4,
                    borderRadius: 9,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: action.badgeColor ?? theme.color.negative,
                    borderWidth: 2,
                    borderColor: theme.color.surface,
                  }}
                >
                  <Text variant="micro" style={{ color: '#FFFFFF', fontWeight: '700' }}>
                    {action.badge > 99 ? '99+' : String(action.badge)}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              variant="micro"
              align="center"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={{
                maxWidth: '100%',
                fontWeight: '600',
                color: theme.color.text,
                ...(labelSize ? { fontSize: labelSize, lineHeight: labelSize + 4 } : null),
              }}
            >
              {action.label}
            </Text>
          </Pressable>
        );
        return (
          <View key={action.key} style={{ flex: 1 }} ref={action.ref} collapsable={false}>
            {action.tourId ? <TourTarget id={action.tourId}>{button}</TourTarget> : button}
          </View>
        );
      })}
    </View>
  );
}

const DISC = 42;
