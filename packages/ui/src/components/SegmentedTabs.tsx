import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

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
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: readonly SegmentedTab<T>[];
}) {
  const theme = useTheme();
  // Three or more tabs with a glyph each do not fit side by side on a phone:
  // at iPhone width a third of the row is ~117pt, and a glyph, its gap and an
  // upper-case word take nearly all of it, so the labels ran into each other.
  // Those stack the glyph over the word, the fixed-tab layout Material uses,
  // which gives each word its tab's whole width. Two tabs have room inline.
  const stacked = tabs.length >= 3 && tabs.every((tab) => tab.icon);

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: theme.color.border,
      }}
    >
      {tabs.map((tab) => {
        const live = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            onPress={() => onChange(tab.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: live }}
            accessibilityLabel={tab.count ? `${tab.label}, ${tab.count}` : tab.label}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: stacked ? 'column' : 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: stacked ? theme.spacing.xs : theme.spacing.sm,
              paddingVertical: stacked ? theme.spacing.sm : theme.spacing.md,
              paddingHorizontal: theme.spacing.xs,
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
                left: theme.spacing.lg,
                right: theme.spacing.lg,
                bottom: -1,
                height: 2,
                borderRadius: 1,
                backgroundColor: live ? theme.color.brand : 'transparent',
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
