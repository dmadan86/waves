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
  scope,
  onScope,
  labels,
  monthText,
  monthActive,
  onOpenMonth,
  onOpenScope,
  searchOpen,
  onToggleSearch,
  query,
  onQuery,
}: {
  scope: ExpenseScope;
  onScope: (next: ExpenseScope) => void;
  labels: {
    all: string;
    mine: string;
    others: string;
    search: string;
    clearSearch: string;
  };
  /** What the month pill says: the chosen month, or "All months". */
  monthText: string;
  monthActive: boolean;
  onOpenMonth: () => void;
  /** Opens the All / Mine / Others menu. */
  onOpenScope: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  query: string;
  onQuery: (next: string) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const scopeText =
    scope === 'mine' ? labels.mine : scope === 'others' ? labels.others : labels.all;
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
          onPress={onOpenScope}
          accessibilityRole="button"
          accessibilityLabel={scopeText}
          style={quiet(scope !== 'all')}
        >
          <Ionicons name="people-outline" size={iconSize.sm} color={inkFor(scope !== 'all')} />
          <Text
            variant="caption"
            numberOfLines={1}
            style={{ fontSize: 13, fontWeight: '600', color: inkFor(scope !== 'all') }}
          >
            {scopeText}
          </Text>
          <Ionicons name="chevron-down" size={12} color={inkFor(scope !== 'all')} />
        </Pressable>
        <Pressable
          onPress={onOpenMonth}
          accessibilityRole="button"
          accessibilityLabel={monthText}
          style={(state) => ({ ...quiet(monthActive)(state), flexShrink: 1 })}
        >
          <Ionicons name="calendar-outline" size={iconSize.sm} color={inkFor(monthActive)} />
          <Text
            variant="caption"
            numberOfLines={1}
            style={{ fontSize: 13, fontWeight: '600', flexShrink: 1, color: inkFor(monthActive) }}
          >
            {monthText}
          </Text>
          <Ionicons name="chevron-down" size={12} color={inkFor(monthActive)} />
        </Pressable>
        <Pressable
          onPress={onToggleSearch}
          accessibilityRole="button"
          accessibilityLabel={labels.search}
          accessibilityState={{ selected: searchOpen }}
          style={(state) => ({ ...quiet(searchOpen || !!query)(state), marginStart: 'auto' })}
        >
          <Ionicons name="search" size={iconSize.md} color={inkFor(searchOpen || !!query)} />
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
            borderRadius: theme.radius.pill,
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
