import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { iconSize, useTheme } from '@waves/ui';
import { GREEN } from '@/components/company/dashboard/parts';
import { RED } from '@/components/company/dashboard/overviewKit';
import type { MenuAnchor } from '@/components/SortMenu';
import { SegmentedPills } from '@/components/standard';
import { useStrings } from '@/i18n';
import type { WorkMode } from '@/lib/companyWork';

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

/** [By date | By person] (managers only), round search (expands to a field) and the round ⋮. */
export function WorkToolbar({
  mode,
  onMode,
  query,
  onQueryChange,
  onMore,
}: {
  /** Null hides the switch (an employee only sees their own tasks). */
  mode: WorkMode | null;
  onMode: (mode: WorkMode) => void;
  query: string;
  onQueryChange: (value: string) => void;
  onMore: (anchor: MenuAnchor | null) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [searching, setSearching] = useState(query !== '');
  const pill: ViewStyle = {
    height: 44,
    borderRadius: 12,
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
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', gap: 6 }}>
        {mode ? (
          <SegmentedPills
            options={[
              { value: 'date' as WorkMode, label: t.company.workByDate },
              { value: 'person' as WorkMode, label: t.company.workByPerson },
              { value: 'status' as WorkMode, label: t.company.workByStatus },
            ]}
            value={mode}
            onChange={onMode}
          />
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.company.workSearch}
        onPress={() => setSearching(true)}
        style={round}
      >
        <Ionicons name="search-outline" size={iconSize.base} color={theme.color.text} />
      </Pressable>
      <Anchored onAnchor={onMore} label={t.company.workFilter} style={round}>
        <Ionicons name="ellipsis-vertical" size={iconSize.base} color={theme.color.text} />
      </Anchored>
    </View>
  );
}
