import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { Text, useTheme } from '@waves/ui';
import { useStrings } from '@/i18n';

export type TeamTab = 'people' | 'attendance';

/** The white People | Attendance switch under the company header. */
export function TeamSegment({
  value,
  onChange,
}: {
  value: TeamTab;
  onChange: (tab: TeamTab) => void;
}) {
  const theme = useTheme(),
    { t } = useStrings();
  const items: { tab: TeamTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { tab: 'people', label: t.company.barPeople, icon: 'people' },
    { tab: 'attendance', label: t.company.attendanceTitle, icon: 'person-circle' },
  ];
  return (
    <View
      style={{
        flexDirection: 'row',
        padding: 4,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.color.border,
        backgroundColor: theme.color.surface,
      }}
    >
      {items.map(({ tab, label, icon }) => {
        const on = tab === value;
        const ink = on ? theme.color.onBrand : theme.color.text;
        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(tab)}
            style={{
              flex: 1,
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              paddingHorizontal: 4,
              borderRadius: 12,
              backgroundColor: on ? theme.color.brand : 'transparent',
            }}
          >
            <Ionicons name={icon} size={18} color={ink} />
            <Text numberOfLines={1} style={{ color: ink, fontWeight: '700', flexShrink: 1 }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
