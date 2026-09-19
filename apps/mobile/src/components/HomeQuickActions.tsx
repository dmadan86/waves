/**
 * THROWAWAY — Home's actions, taken out of the hero and laid out as tiles.
 *
 * Built to be looked at, not to be kept. Nothing else imports it; deleting this
 * file and the block in `app/(tabs)/index.tsx` that renders it puts Home back
 * exactly as it was.
 *
 * The question it exists to answer: Home currently spends a row *inside* the
 * coloured hero on two controls — a white "add expense" pill and a circle for
 * starting a group — which means the hero is doing two jobs at once, saying who
 * you are and what you owe, and also being a toolbar. The expense screen does
 * not work that way: its hero holds the number, and the things you can do with
 * the number sit in a strip underneath it. This applies that same shape to
 * Home, and widens the strip from two actions to five, the way MyGate and most
 * Indian super-apps open.
 *
 * What it borrows:
 *
 *   - The tile grammar from `QuickAddSheet` — a tinted disc holding the glyph,
 *     with the action named beneath it. `tintForKey` is the same function that
 *     sheet uses, so an action that appears in both wears the same colour in
 *     both. "Add expense" and "Scan bill" are the two that do.
 *   - A horizontal scroller rather than a wrapping grid, for the reason the
 *     quick-amount ladder scrolls: five tiles do not divide into a 360pt screen
 *     without either shrinking the targets below 44pt or wrapping to a second
 *     row whose single orphan tile reads as a mistake. Scrolling keeps every
 *     target full size and the block one row tall whatever the locale does to
 *     the labels.
 *
 * Deliberately not overlapping the hero. A card pulled up under a rounded hero
 * corner is the obvious MyGate flourish, and it is how you get a row of buttons
 * that cannot be pressed: a view painted outside its parent's bounds is dead
 * there on Android, and nothing about it looks broken until you tap it.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { iconSize, Text, tintForKey, useTheme } from '@waves/ui';

/** One tile. Mirrors `QuickAddAction`, but these do not all add something. */
export interface HomeAction {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Stable key for the disc's tint, so an action keeps its colour. */
  tintKey: string;
  onPress: () => void;
  /**
   * Kept because the hero pill this replaces had one: a long press on "add
   * expense" raised the type/scan/speak sheet. Dropping the tile would have
   * dropped that gesture silently.
   */
  onLongPress?: () => void;
  /** Wraps the tile — the tour anchors on two of these. */
  wrap?: (tile: React.JSX.Element) => React.JSX.Element;
}

/**
 * Wide enough for two words of Tamil or Arabic without clipping, narrow enough
 * that a fifth tile peeks in at 360pt and says the row scrolls.
 */
const TILE = 76;
const DISC = 56;

export function HomeQuickActions({
  actions,
}: {
  actions: readonly HomeAction[];
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
      }}
    >
      {actions.map((action) => {
        const tint = theme.tint[tintForKey(action.tintKey)];
        const tile = (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            onLongPress={action.onLongPress}
            style={({ pressed }) => ({
              width: TILE,
              alignItems: 'center',
              gap: theme.spacing.xs,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View
              style={{
                width: DISC,
                height: DISC,
                borderRadius: DISC / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tint.bg,
              }}
            >
              <Ionicons name={action.icon} size={iconSize.lg} color={tint.ink} />
            </View>
            {/* Two lines, centred: "Bank messages" and its translations do not
                fit on one at this width, and a truncated label on a glyph the
                person has not learned yet is no label at all. */}
            <Text variant="caption" numberOfLines={2} style={{ textAlign: 'center' }}>
              {action.label}
            </Text>
          </Pressable>
        );
        return <View key={action.label}>{action.wrap ? action.wrap(tile) : tile}</View>;
      })}
    </ScrollView>
  );
}
