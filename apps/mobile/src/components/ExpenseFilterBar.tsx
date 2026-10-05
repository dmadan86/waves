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
  searchOpen: boolean;
  onToggleSearch: () => void;
  query: string;
  onQuery: (next: string) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const chips: readonly { key: ExpenseScope; label: string }[] = [
    { key: 'all', label: labels.all },
    { key: 'mine', label: labels.mine },
    { key: 'others', label: labels.others },
  ];
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        {chips.map((chip) => {
          const live = chip.key === scope;
          return (
            <Pressable
              key={chip.key}
              onPress={() => onScope(chip.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: live }}
              style={({ pressed }) => ({
                height: CHIP_HEIGHT,
                paddingHorizontal: theme.spacing.lg,
                borderRadius: CHIP_HEIGHT / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: live ? theme.color.brand : theme.color.surfaceMuted,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text
                variant="caption"
                numberOfLines={1}
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  color: live ? theme.color.onBrand : theme.color.textMuted,
                }}
              >
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={onOpenMonth}
          accessibilityRole="button"
          accessibilityLabel={monthText}
          style={({ pressed }) => ({
            marginStart: 'auto',
            flexShrink: 1,
            height: CHIP_HEIGHT,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            paddingHorizontal: theme.spacing.md,
            borderRadius: CHIP_HEIGHT / 2,
            borderWidth: 1,
            borderColor: monthActive ? theme.color.brand : theme.color.border,
            backgroundColor: theme.color.surface,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Ionicons name="calendar-outline" size={iconSize.sm} color={theme.color.text} />
          <Text
            variant="caption"
            numberOfLines={1}
            style={{ fontSize: 13, fontWeight: '600', flexShrink: 1 }}
          >
            {monthText}
          </Text>
          <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
        </Pressable>
        <Pressable
          onPress={onToggleSearch}
          accessibilityRole="button"
          accessibilityLabel={labels.search}
          accessibilityState={{ selected: searchOpen }}
          style={({ pressed }) => ({
            width: CHIP_HEIGHT,
            height: CHIP_HEIGHT,
            borderRadius: CHIP_HEIGHT / 2,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: searchOpen || query ? theme.color.brand : theme.color.border,
            backgroundColor: theme.color.surface,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Ionicons name="search" size={iconSize.md} color={theme.color.text} />
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
