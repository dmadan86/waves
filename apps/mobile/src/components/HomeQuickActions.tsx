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
 * Home.
 *
 * What it borrows:
 *
 *   - The tile grammar from `QuickAddSheet` — a tinted disc holding the glyph,
 *     with the action named beneath it. `tintForKey` is the same function that
 *     sheet uses, so an action that appears in both wears the same colour in
 *     both. "Add expense" and "Scan bill" are the two that do.
 *   - The row itself from Revolut Business, N26 and Cleo, all of which spread a
 *     small fixed set of discs across the width and stop there. None of them
 *     scrolls: a shortcut you have to find by dragging is not a shortcut, and a
 *     tile cut in half by the right edge reads as a rendering fault rather than
 *     an invitation.
 *
 * Two consequences of not scrolling, both deliberate:
 *
 *   - The set has to stay at four. Whatever is fifth belongs in the hero's
 *     overflow menu or its own tab, not here.
 *   - A horizontal `ScrollView` cannot be used even for the overflow case,
 *     because React Native's base scroll style is `flexGrow: 1` — inside Home's
 *     `flexGrow: 1` content container that made the strip swallow every spare
 *     point of the column, opening a dead band between the tiles and "Your
 *     groups" that nothing in the layout accounted for.
 *
 * Deliberately not overlapping the hero. A card pulled up under a rounded hero
 * corner is the obvious MyGate flourish, and it is how you get a row of buttons
 * that cannot be pressed: a view painted outside its parent's bounds is dead
 * there on Android, and nothing about it looks broken until you tap it.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

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
 * Smaller than the sheet's disc. The sheet is a menu you are reading; this is a
 * strip you glance past on the way to the groups, and at 56 it competed with
 * the hero for the eye. 52 keeps the tap target well over 44 with the label
 * counted in.
 */
const DISC = 52;

export function HomeQuickActions({
  actions,
}: {
  actions: readonly HomeAction[];
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.lg,
        paddingBottom: theme.spacing.sm,
        gap: theme.spacing.sm,
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
                person has not learned yet is no label at all. The tile takes an
                equal share of the row (`flex: 1` on the wrapper below), so the
                width a label has to wrap into is the same in every locale. */}
            <Text variant="caption" numberOfLines={2} style={{ textAlign: 'center' }}>
              {action.label}
            </Text>
          </Pressable>
        );
        return (
          <View key={action.label} style={{ flex: 1 }}>
            {action.wrap ? action.wrap(tile) : tile}
          </View>
        );
      })}
    </View>
  );
}
