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
 * The shape is the one every commerce app opens on: a row of quiet discs, each
 * holding one line-drawn glyph with its name centred underneath. What that
 * costs and what it buys:
 *
 *   - **Discs, not squares.** An earlier pass argued the opposite — that a row
 *     of squares reads as a board of controls and a disc reads as a single one.
 *     On the screen it did not: the squares read as four cards, competing with
 *     the group cards below them. A disc has no corners to line up with
 *     anything, so the row recedes to what it is, a strip of shortcuts.
 *   - **One accent, not four tints.** Every disc is the launch yellow and every
 *     glyph the ink that reads on it — GoodRx's home screen, where one colour
 *     sits behind every glyph. A coloured glyph per action makes each one a
 *     thing to identify before you can read the row; in one colour the row is
 *     read as a row and the *shapes* do the distinguishing, which is what a line
 *     drawing is for. The colour is decoration and carries no meaning: money
 *     keeps its own blue and raspberry, wherever it appears.
 *   - **A "view more" cell that leads somewhere.** It opens the overflow menu,
 *     the only other list of everything Home can reach. It is the one inverted
 *     disc — ink filled, yellow glyph — so the way out of the row is findable
 *     without reading, and without introducing a second colour to do it.
 *   - **No heading.** A label over four labelled icons is a line of text
 *     saying what is already plain.
 *
 * Nothing scrolls. A shortcut you have to find by dragging is not a shortcut,
 * and the horizontal `ScrollView` this replaced had a second problem: React
 * Native's base scroll style is `flexGrow: 1`, and inside Home's `flexGrow: 1`
 * content container it swallowed every spare point of the column, opening a
 * dead band between the actions and "Your groups" that nothing in the layout
 * accounted for.
 *
 * Deliberately not overlapping the hero. A card pulled up under a rounded hero
 * corner is the obvious flourish, and it is how you get a row of buttons that
 * cannot be pressed: a view painted outside its parent's bounds is dead there
 * on Android, and nothing about it looks broken until you tap it.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

/** One cell. Mirrors `QuickAddAction`, but these do not all add something. */
export interface HomeAction {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
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
   * The last cell: the one disc that carries the brand rather than the ink, so
   * "everything else" is findable without reading. At most one action sets it.
   */
  accent?: boolean;
}

/** Four to a row, the way every super-app on an Indian phone opens. */
const COLUMNS = 4;
/** The disc. 64 leaves the label room under it without a third row. */
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
                    // A true circle, not a generous corner: half the side, so
                    // the disc stays a disc if `TILE` is ever tuned.
                    borderRadius: TILE / 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    // The launch yellow, the way GoodRx puts one accent behind
                    // every glyph on its home screen: the row reads as one strip
                    // of shortcuts, and the colour is the app's own rather than
                    // a per-action tint nobody has to learn.
                    backgroundColor: action.accent ? theme.color.onAccent : theme.color.accent,
                  }}
                >
                  <Ionicons
                    name={action.icon}
                    size={iconSize.xxl}
                    // "Everything else" is the one inverted disc — ink filled,
                    // yellow glyph — so the way out of the row is findable
                    // without reading, and without a second colour.
                    color={action.accent ? theme.color.accent : theme.color.onAccent}
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
