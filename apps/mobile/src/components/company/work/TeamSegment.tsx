import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { Text, useTheme } from '@waves/ui';
import { useWorkdayCounts } from '@/data/companyWorkday';
import { useStrings } from '@/i18n';

export type TeamTab = 'attendance' | 'work';

/** The white Attendance | Daily work switch that rides over the foot of the header. */
export function TeamSegment({
  groupId,
  value,
  onChange,
}: {
  groupId: string;
  value: TeamTab;
  onChange: (tab: TeamTab) => void;
}) {
  const theme = useTheme(),
    { t } = useStrings();
  // A red dot on Daily work while any task today is blocked.
  const attention = useWorkdayCounts(groupId).blocked > 0;
  const items: { tab: TeamTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { tab: 'attendance', label: t.company.attendanceTitle, icon: 'person-circle' },
    { tab: 'work', label: t.company.workTitle, icon: 'checkbox-outline' },
  ];
  return (
    <View
      style={{
        flexDirection: 'row',
        padding: 4,
        borderRadius: 20,
        backgroundColor: theme.color.surface,
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
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
              gap: 6,
              borderRadius: 16,
              backgroundColor: on ? theme.color.brand : 'transparent',
            }}
          >
            <Ionicons name={icon} size={20} color={ink} />
            <Text numberOfLines={1} style={{ color: ink, fontWeight: '700', flexShrink: 1 }}>
              {label}
            </Text>
            {tab === 'work' && attention ? (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: theme.color.negative,
                  marginTop: -8,
                }}
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
