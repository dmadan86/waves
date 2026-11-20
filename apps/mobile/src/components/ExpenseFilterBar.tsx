import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

/** Who paid: everything, what you paid for, or what somebody else paid. */
export type ExpenseScope = 'all' | 'mine' | 'others';

const CHIP_HEIGHT = 30;

/**
 * The Expenses tab's filter row: All / Mine / Others chips, a month pill and a
 * round search button that opens a one-line search field under the row. Purely
 * presentational — the screen owns the state and does the filtering.
 */
export function ExpenseFilterBar({
  pillText,
  pillActive,
  pillLabel,
  onOpenFilter,
  searchLabel,
  clearSearchLabel,
  searchOpen,
  onToggleSearch,
  query,
  onQuery,
}: {
  /** What the one Filter pill says, whether anything is on, and its screen-reader label. */
  pillText: string;
  pillActive: boolean;
  pillLabel: string;
  onOpenFilter: () => void;
  searchLabel: string;
  clearSearchLabel: string;
  searchOpen: boolean;
  onToggleSearch: () => void;
  query: string;
  onQuery: (next: string) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const labels = { search: searchLabel, clearSearch: clearSearchLabel };
  // Quiet text buttons, not filled pills: the filters are there when wanted
  // and take one slim line when not.
  const quiet =
    (active: boolean) =>
    ({ pressed }: { pressed: boolean }) => ({
      height: CHIP_HEIGHT,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 4,
      paddingHorizontal: theme.spacing.sm,
      borderRadius: CHIP_HEIGHT / 2,
      backgroundColor: active ? theme.color.brandSoft : 'transparent',
      opacity: pressed ? 0.6 : 1,
    });
  const inkFor = (active: boolean) => (active ? theme.color.brand : theme.color.textMuted);
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
        <Pressable
          onPress={onToggleSearch}
          accessibilityRole="button"
          accessibilityLabel={labels.search}
          accessibilityState={{ selected: searchOpen }}
          style={quiet(searchOpen || !!query)}
        >
          <Ionicons name="search" size={iconSize.md} color={inkFor(searchOpen || !!query)} />
        </Pressable>
        <Pressable
          onPress={onOpenFilter}
          accessibilityRole="button"
          accessibilityLabel={pillLabel}
          style={(state) => ({ ...quiet(pillActive)(state), flexShrink: 1, marginStart: 'auto' })}
        >
          <Ionicons name="options-outline" size={iconSize.sm} color={inkFor(pillActive)} />
          <Text
            variant="caption"
            numberOfLines={1}
            style={{ fontSize: 13, fontWeight: '600', flexShrink: 1, color: inkFor(pillActive) }}
          >
            {pillText}
          </Text>
          <Ionicons name="chevron-down" size={12} color={inkFor(pillActive)} />
        </Pressable>
      </Row>
      {searchOpen ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            height: 36,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.border,
          }}
        >
          <Ionicons name="search" size={iconSize.md} color={theme.color.textMuted} />
          <TextInput
            value={query}
            onChangeText={onQuery}
            autoFocus
            autoCapitalize="none"
            accessibilityRole="search"
            accessibilityLabel={labels.search}
            placeholder={labels.search}
            placeholderTextColor={theme.color.textMuted}
            selectionColor={theme.color.brand}
            style={{ flex: 1, fontSize: 14, color: theme.color.text, paddingVertical: 0 }}
          />
          {query ? (
            <Pressable
              onPress={() => onQuery('')}
              accessibilityRole="button"
              accessibilityLabel={labels.clearSearch}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={iconSize.md} color={theme.color.textMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
