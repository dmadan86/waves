import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useTheme } from '../theme';
import { Text } from './Text';

export interface SegmentedTab<T extends string> {
  readonly value: T;
  readonly label: string;
  /**
   * A mark beside the word, drawn in whatever colour the tab is wearing — the
   * same shape `ChipRow` uses, so one convention covers both. Optional: a tab
   * row where only some tabs had a glyph would read as an accident, so pass one
   * for every tab or for none.
   */
  readonly icon?: (color: string) => ReactNode;
  /**
   * How many things are behind the tab, drawn as a small pill after the word
   * rather than written into it. "ADDED BY YOU 3" read as one long label and
   * left its tab looking crowded next to a short neighbour; a pill reads as a
   * count at a glance. Zero or absent draws nothing.
   */
  readonly count?: number;
}

/**
 * Tabs that divide one screen, not the app.
 *
 * `PillTabBar` moves you between destinations and floats above everything to
 * say so. This is the other kind: the page you are on has three faces and this
 * chooses which one. It reads as part of the page — a rule underneath, a mark
 * under the live one — because a second floating pill on the same screen would
 * be two things claiming to be the navigation.
 *
 * Small caps and letterspacing are the one place the app raises its voice like
 * this. It works here because the row is a label for what follows rather than
 * something to read, and because this screen has a single number on it.
 */
export function SegmentedTabs<T extends string>({
  value,
  onChange,
  tabs,
  scrollable = false,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: readonly SegmentedTab<T>[];
  /**
   * Each tab as wide as its own glyph and word, side by side in one line, with
   * the row scrolling sideways when they do not all fit. For a screen with
   * more faces than a phone's width can share out evenly: stacking the glyph
   * over the word kept four tabs on screen, but made each one a small column
   * that read as an icon grid rather than a row of labels.
   */
  scrollable?: boolean;
}) {
  const theme = useTheme();
  // Three or more tabs with a glyph each do not fit side by side on a phone:
  // at iPhone width a third of the row is ~117pt, and a glyph, its gap and an
  // upper-case word take nearly all of it, so the labels ran into each other.
  // Those stack the glyph over the word, the fixed-tab layout Material uses,
  // which gives each word its tab's whole width. Two tabs have room inline.
  const stacked = !scrollable && tabs.length >= 3 && tabs.every((tab) => tab.icon);

  // Keep the live tab in view: picked from the far end, or chosen from code,
  // it must not sit scrolled off the edge.
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef(new Map<T, { x: number; width: number }>());
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    if (!scrollable) return;
    const at = offsets.current.get(value);
    if (!at || rowWidth === 0) return;
    scroller.current?.scrollTo({
      x: Math.max(0, at.x + at.width / 2 - rowWidth / 2),
      animated: true,
    });
  }, [scrollable, value, rowWidth]);

  const items = tabs.map((tab) => {
    const live = tab.value === value;
    return (
      <Pressable
        key={tab.value}
        onPress={() => onChange(tab.value)}
        accessibilityRole="tab"
        accessibilityState={{ selected: live }}
        accessibilityLabel={tab.count ? `${tab.label}, ${tab.count}` : tab.label}
        onLayout={
          scrollable
            ? (event) => {
                const { x, width } = event.nativeEvent.layout;
                offsets.current.set(tab.value, { x, width });
              }
            : undefined
        }
        style={({ pressed }) => ({
          ...(scrollable ? {} : { flex: 1 }),
          flexDirection: stacked ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: stacked ? theme.spacing.xs : theme.spacing.sm,
          paddingVertical: stacked ? theme.spacing.sm : theme.spacing.md,
          paddingHorizontal: scrollable ? theme.spacing.md : theme.spacing.xs,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        {tab.icon?.(live ? theme.color.brand : theme.color.textFaint)}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            flexShrink: 1,
          }}
        >
          <Text
            variant="caption"
            tone={live ? 'brand' : 'faint'}
            numberOfLines={1}
            style={{ letterSpacing: 0.8, fontWeight: live ? '700' : '600', flexShrink: 1 }}
          >
            {tab.label.toUpperCase()}
          </Text>
          {tab.count ? (
            <View
              style={{
                minWidth: 20,
                height: 20,
                paddingHorizontal: 6,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: live ? theme.color.brand : theme.color.surfaceMuted,
              }}
            >
              <Text
                variant="micro"
                style={{
                  fontWeight: '700',
                  color: live ? theme.color.onBrand : theme.color.textMuted,
                }}
              >
                {tab.count > 99 ? '99+' : String(tab.count)}
              </Text>
            </View>
          ) : null}
        </View>
        {/* Drawn whether or not it is live, so the label does not shift by
                two points as you move between tabs. */}
        <View
          style={{
            position: 'absolute',
            left: scrollable ? theme.spacing.sm : theme.spacing.lg,
            right: scrollable ? theme.spacing.sm : theme.spacing.lg,
            // Fixed tabs hang the mark onto the row's rule; a scroll view
            // clips anything outside it, so there it sits just above.
            bottom: scrollable ? 0 : -1,
            height: 2,
            borderRadius: 1,
            backgroundColor: live ? theme.color.brand : 'transparent',
          }}
        />
      </Pressable>
    );
  });

  if (scrollable) {
    return (
      <View
        style={{ borderBottomWidth: 1, borderBottomColor: theme.color.border }}
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
      >
        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="tablist"
          contentContainerStyle={{ gap: theme.spacing.sm }}
        >
          {items}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: theme.color.border,
      }}
    >
      {items}
    </View>
  );
}
