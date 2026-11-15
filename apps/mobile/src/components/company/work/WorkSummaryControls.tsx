import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { iconSize, Text, useTheme } from '@waves/ui';
import { GREEN } from '@/components/company/dashboard/parts';
import { RED } from '@/components/company/dashboard/overviewKit';
import type { MenuAnchor } from '@/components/SortMenu';
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

const MODES = [
  { value: 'date', label: 'workByDate', icon: 'calendar-outline' },
  { value: 'person', label: 'workByPerson', icon: 'person-outline' },
  { value: 'status', label: 'workByStatus', icon: 'flag-outline' },
] as const;

/** [By date | By person] (managers only), round search (expands to a field) and the round ⋮. */
export function WorkToolbar({
  mode,
  onMode,
  query,
  onQueryChange,
  onMore,
  title,
  onAdd,
}: {
  /** Null hides the switch (an employee only sees their own tasks). */
  mode: WorkMode | null;
  onMode: (mode: WorkMode) => void;
  query: string;
  onQueryChange: (value: string) => void;
  onMore: (anchor: MenuAnchor | null) => void;
  /** The Tasks page header: title with its subtitle, and the brand Add pill for those who can add. */
  title?: string;
  onAdd?: () => void;
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
  const round: ViewStyle = {
    ...pill,
    width: 44,
    borderRadius: 22,
    paddingHorizontal: 0,
    justifyContent: 'center',
  };
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
  const buttons = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.company.workSearch}
        onPress={() => setSearching(true)}
        style={round}
      >
        <Ionicons name="search-outline" size={iconSize.base} color={theme.color.text} />
      </Pressable>
      <Anchored onAnchor={onMore} label={t.company.workFilter} style={round}>
        <Ionicons
          name={title ? 'options-outline' : 'ellipsis-vertical'}
          size={iconSize.base}
          color={theme.color.text}
        />
      </Anchored>
      {title && onAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.company.workAdd}
          onPress={onAdd}
          style={{ ...pill, backgroundColor: theme.color.brand, borderColor: theme.color.brand }}
        >
          <Ionicons name="add" size={iconSize.base} color={theme.color.onBrand} />
          <Text style={{ color: theme.color.onBrand, fontWeight: '700' }}>{t.company.workAdd}</Text>
        </Pressable>
      ) : null}
    </>
  );
  return (
    <View style={{ gap: 8 }}>
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="title" numberOfLines={1} style={{ fontWeight: '800' }}>
              {title}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {t.company.workHeaderSub}
            </Text>
          </View>
          {buttons}
        </View>
      ) : null}
      {mode || !title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {mode ? (
            <View
              accessibilityRole="tablist"
              style={{
                flex: 1,
                minWidth: 0,
                flexDirection: 'row',
                padding: 3,
                gap: 2,
                borderRadius: 14,
                backgroundColor: theme.color.surface,
                borderWidth: 1,
                borderColor: theme.color.border,
              }}
            >
              {MODES.map((option) => {
                const on = option.value === mode;
                const ink = on ? theme.color.onBrand : theme.color.textMuted;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    onPress={() => onMode(option.value)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      minHeight: 44,
                      borderRadius: 11,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      backgroundColor: on ? theme.color.brand : 'transparent',
                    }}
                  >
                    <Ionicons name={option.icon} size={iconSize.sm} color={ink} />
                    <Text
                      variant="caption"
                      numberOfLines={1}
                      style={{ color: ink, fontWeight: on ? '700' : '500', flexShrink: 1 }}
                    >
                      {t.company[option.label]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {title ? null : buttons}
        </View>
      ) : null}
    </View>
  );
}
