import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { iconSize, Text, useTheme } from '@waves/ui';
import { GREEN } from '@/components/company/dashboard/parts';
import { RED } from '@/components/company/dashboard/overviewKit';
import type { MenuAnchor } from '@/components/SortMenu';
import { useStrings } from '@/i18n';

/** The tint each status wears in its row pill (the mockup: blue, amber, green, red). */
export const WORK_INK = {
  todo: '#1D4ED8',
  doing: '#B45309',
  done: GREEN,
  blocked: RED,
} as const;

/** A pressable that reports where it sits on screen, for an anchored menu. */
function Anchored({
  onAnchor,
  style,
  label,
  children,
}: {
  onAnchor: (anchor: MenuAnchor | null) => void;
  style: StyleProp<ViewStyle>;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<View>(null);
  return (
    <View ref={ref} collapsable={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() =>
          ref.current
            ? ref.current.measureInWindow((x, y, width, height) =>
                onAnchor(width > 0 ? { x, y, width, height } : null),
              )
            : onAnchor(null)
        }
        style={style}
      >
        {children}
      </Pressable>
    </View>
  );
}

/** Date pill, status dropdown, round search (expands to a field) and round sort button. */
export function WorkToolbar({
  dayLabel,
  onDay,
  statusLabel,
  onStatus,
  query,
  onQueryChange,
  onSort,
}: {
  dayLabel: string;
  onDay: () => void;
  statusLabel: string;
  onStatus: (anchor: MenuAnchor | null) => void;
  query: string;
  onQueryChange: (value: string) => void;
  onSort: (anchor: MenuAnchor | null) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [searching, setSearching] = useState(query !== '');
  const pill: ViewStyle = {
    height: 44,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
  };
  const round: ViewStyle = { ...pill, width: 44, paddingHorizontal: 0, justifyContent: 'center' };
  if (searching)
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ ...pill, flex: 1, minWidth: 0 }}>
          <Ionicons name="search-outline" size={iconSize.base} color={theme.color.textMuted} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={onQueryChange}
            placeholder={t.company.workSearch}
            placeholderTextColor={theme.color.textFaint}
            style={{ flex: 1, minWidth: 0, color: theme.color.text, fontSize: 14, padding: 0 }}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.common.close}
          onPress={() => {
            onQueryChange('');
            setSearching(false);
          }}
          style={round}
        >
          <Ionicons name="close" size={iconSize.base} color={theme.color.textMuted} />
        </Pressable>
      </View>
    );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={dayLabel}
        onPress={onDay}
        style={{ ...pill, flexShrink: 1, minWidth: 0 }}
      >
        <Ionicons name="calendar-outline" size={iconSize.base} color={theme.color.brand} />
        <Text variant="caption" numberOfLines={1} style={{ fontWeight: '700', flexShrink: 1 }}>
          {dayLabel}
        </Text>
        <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Anchored onAnchor={onStatus} label={statusLabel} style={pill}>
          <Ionicons name="layers-outline" size={iconSize.base} color={theme.color.brand} />
          <Text variant="caption" numberOfLines={1} style={{ fontWeight: '700', flexShrink: 1 }}>
            {statusLabel}
          </Text>
          <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
        </Anchored>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.company.workSearch}
        onPress={() => setSearching(true)}
        style={round}
      >
        <Ionicons name="search-outline" size={iconSize.base} color={theme.color.text} />
      </Pressable>
      <Anchored onAnchor={onSort} label={t.company.workFilter} style={round}>
        <Ionicons name="swap-vertical" size={iconSize.base} color={theme.color.text} />
      </Anchored>
    </View>
  );
}
