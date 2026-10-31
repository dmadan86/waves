import { useRef } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { iconSize, Text, useTheme } from '@waves/ui';
import { GREEN } from '@/components/company/dashboard/parts';
import { RED, withAlpha } from '@/components/company/dashboard/overviewKit';
import type { MenuAnchor } from '@/components/SortMenu';
import { StandardCard } from '@/components/standard';
import { useStrings } from '@/i18n';
import type { WorkChip } from '@/lib/companyWork';

export const WORK_ORANGE = '#C2410C';
/** The tint each status wears, in chips and row pills (the mockup: red, orange, green). */
export const WORK_INK: Record<WorkChip | 'blocked', string | null> = {
  all: null,
  todo: RED,
  doing: WORK_ORANGE,
  done: GREEN,
  blocked: RED,
};

/** One pill: the day picker, a divider and the search field; a round sort button beside it. */
export function WorkToolbar({
  dayLabel,
  onDay,
  query,
  onQueryChange,
  onSort,
}: {
  dayLabel: string;
  onDay: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  onSort: (anchor: MenuAnchor | null) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const sortRef = useRef<View>(null);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <StandardCard
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 0,
          paddingHorizontal: 12,
          minHeight: 44,
          borderRadius: 22,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dayLabel}
          onPress={onDay}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}
        >
          <Ionicons name="calendar-outline" size={iconSize.base} color={theme.color.brand} />
          <Text variant="caption" style={{ fontWeight: '700' }}>
            {dayLabel}
          </Text>
          <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
        </Pressable>
        <View style={{ width: 1, height: 20, backgroundColor: theme.color.border }} />
        <Ionicons name="search-outline" size={iconSize.base} color={theme.color.textMuted} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder={t.company.workSearch}
          placeholderTextColor={theme.color.textFaint}
          style={{ flex: 1, minWidth: 0, color: theme.color.text, fontSize: 14, padding: 0 }}
        />
      </StandardCard>
      <View ref={sortRef} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.company.workFilter}
          onPress={() =>
            sortRef.current
              ? sortRef.current.measureInWindow((x, y, width, height) =>
                  onSort(width > 0 ? { x, y, width, height } : null),
                )
              : onSort(null)
          }
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.border,
          }}
        >
          <Ionicons name="swap-vertical" size={iconSize.base} color={theme.color.brand} />
        </Pressable>
      </View>
    </View>
  );
}

/** All · To do · In progress · Done (· Blocked once something is): tinted, one tap filters. */
export function WorkChips({
  chips,
  value,
  onChange,
}: {
  chips: readonly { key: WorkChip; label: string }[];
  value: WorkChip;
  onChange: (chip: WorkChip) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {chips.map(({ key, label }) => {
        const ink = WORK_INK[key];
        const on = value === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(key)}
            style={{
              minWidth: 64,
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 7,
              borderRadius: 18,
              backgroundColor: on && !ink ? theme.color.brand : withAlpha(ink ?? '#6D28D9', 0.12),
              borderWidth: on && ink ? 1.5 : 0,
              borderColor: ink ?? undefined,
            }}
          >
            <Text
              variant="caption"
              style={{
                fontWeight: '700',
                color: ink ?? (on ? '#fff' : theme.color.brand),
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
