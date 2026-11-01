import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View, type ViewStyle } from 'react-native';
import { iconSize, Text, useTheme } from '@waves/ui';
import type { MenuAnchor } from '@/components/SortMenu';
import { useStrings } from '@/i18n';

/** Date pill on the left, round search (expands to a field) and round ⋮ on the right. */
export function AttendanceToolbar({
  dayLabel,
  onDay,
  query,
  onQueryChange,
  onMenu,
  menuLabel,
}: {
  dayLabel: string;
  onDay: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  onMenu: (anchor: MenuAnchor | null) => void;
  menuLabel: string;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const menuRef = useRef<View>(null);
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
            placeholder={t.company.attendanceSearch}
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
      <View style={{ flex: 1 }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.company.attendanceSearch}
        onPress={() => setSearching(true)}
        style={round}
      >
        <Ionicons name="search-outline" size={iconSize.base} color={theme.color.text} />
      </Pressable>
      <View ref={menuRef} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={menuLabel}
          onPress={() =>
            menuRef.current
              ? menuRef.current.measureInWindow((x, y, width, height) =>
                  onMenu(width > 0 ? { x, y, width, height } : null),
                )
              : onMenu(null)
          }
          style={round}
        >
          <Ionicons name="ellipsis-vertical" size={iconSize.base} color={theme.color.text} />
        </Pressable>
      </View>
    </View>
  );
}
