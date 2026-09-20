/**
 * Home's actions, taken out of the hero and laid out as a grid.
 *
 * The question it answers: Home used to spend a row *inside* the coloured hero
 * on two controls — a white "add expense" pill and a circle for starting a
 * group — which made the hero do two jobs at once, saying who you are and what
 * you owe, and also being a toolbar. The expense screen does not work that way:
 * its hero holds the number, and the things you can do with the number sit in a
 * strip underneath it.
 *
 * The shape is MyGate's "Quick Actions" panel: a four-column grid of white rounded squares, each holding one glyph with
 * its name underneath, and the last one filled in an accent colour to open
 * everything else. What it takes from that panel, and what it leaves:
 *
 *   - **Squares, not discs.** A disc reads as a single control; a row of
 *     squares reads as a board of them.
 *   - **A "view more" cell that leads somewhere.** MyGate's opens the full
 *     catalogue of services; ours opens the overflow menu, which is the only
 *     other list of everything Home can reach.
 *   - **Neither the heading nor the "Customise" link.** MyGate names the panel
 *     because its home is a stack of a dozen sections and the name is how you
 *     find this one; Home has the hero, this row and the groups, so a label over
 *     four labelled icons is a line of text saying what is already plain. The
 *     link is out because MyGate's rearranges the grid and nothing here does.
 *
 * The glyph keeps the colour it wears in `QuickAddSheet` (`tintForKey`, the
 * same function), so an action that appears in both is the same colour in both
 * — the tint moves from the disc's fill to the glyph itself, because a row of
 * filled discs is a fruit bowl.
 *
 * Nothing scrolls. A shortcut you have to find by dragging is not a shortcut,
 * and the horizontal `ScrollView` this replaced had a second problem: React
 * Native's base scroll style is `flexGrow: 1`, and inside Home's `flexGrow: 1`
 * content container it swallowed every spare point of the column, opening a
 * dead band between the actions and "Your groups" that nothing in the layout
 * accounted for.
 *
 * Deliberately not overlapping the hero. A card pulled up under a rounded hero
 * corner is the obvious MyGate flourish, and it is how you get a row of buttons
 * that cannot be pressed: a view painted outside its parent's bounds is dead
 * there on Android, and nothing about it looks broken until you tap it.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { iconSize, Row, Text, tintForKey, useTheme } from '@waves/ui';

/** One cell. Mirrors `QuickAddAction`, but these do not all add something. */
export interface HomeAction {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Stable key for the glyph's tint, so an action keeps its colour. */
  tintKey: string;
  onPress: () => void;
  /**
   * Kept because the hero pill this replaces had one: a long press on "add
   * expense" raised the type/scan/speak sheet. Dropping the tile would have
   * dropped that gesture silently.
   */
  onLongPress?: () => void;
  /** Wraps the cell — the tour anchors on two of these. */
  wrap?: (tile: React.JSX.Element) => React.JSX.Element;
  /**
   * The last cell: filled in the brand colour rather than white, the way
   * MyGate's "View More" is the one yellow square on the board. At most one
   * action sets this.
   */
  accent?: boolean;
}

/** Four to a row, the way every super-app on an Indian phone opens. */
const COLUMNS = 4;
/** The white square. 64 leaves the label room under it without a third row. */
const TILE = 64;

/** Chunks the actions into rows of four, last row short if the set is not a multiple. */
function rows(actions: readonly HomeAction[]): HomeAction[][] {
  const out: HomeAction[][] = [];
  for (let i = 0; i < actions.length; i += COLUMNS) out.push(actions.slice(i, i + COLUMNS));
  return out;
}

export function HomeQuickActions({
  actions,
}: {
  actions: readonly HomeAction[];
}): React.JSX.Element {
  const theme = useTheme();
  const grid = rows(actions);

  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.lg,
        paddingBottom: theme.spacing.md,
        gap: theme.spacing.md,
      }}
    >
      {grid.map((row, index) => (
        <Row
          // The rows are a layout detail of one fixed list, not a list of their
          // own — index is the only identity they have.
          key={index}
          style={{ gap: theme.spacing.sm }}
        >
          {row.map((action) => {
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
                    width: TILE,
                    height: TILE,
                    borderRadius: theme.radius.lg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: action.accent ? theme.color.brand : theme.color.surface,
                  }}
                >
                  <Ionicons
                    name={action.icon}
                    size={iconSize.xxl}
                    color={action.accent ? theme.color.onBrand : tint.ink}
                  />
                </View>
                {/* Two lines, centred: "Bank messages" and its translations do
                    not fit on one at this width, and a truncated label on a
                    glyph the person has not learned yet is no label at all.
                    Every cell is an equal quarter of the row, so the width a
                    label wraps into is the same in every locale. */}
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
          {/* A short last row keeps its cells the same size as a full one, so
              the columns line up instead of spreading. */}
          {row.length < COLUMNS
            ? Array.from({ length: COLUMNS - row.length }, (_, i) => (
                <View key={`pad-${i}`} style={{ flex: 1 }} />
              ))
            : null}
        </Row>
      ))}
    </View>
  );
}
