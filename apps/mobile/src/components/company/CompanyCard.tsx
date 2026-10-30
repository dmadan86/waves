import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, View } from 'react-native';

import { Text, directionalIcon, useTheme } from '@waves/ui';

import { BUILDING_ART } from './dashboard/art';

type CompanyCardProps = {
  name: string;
  logo: string | null;
  employees: string;
  managers: string;
  owners: string;
  current: boolean;
  currentLabel: string;
  onPress: () => void;
};

export function CompanyCard({
  name,
  logo,
  employees,
  managers,
  owners,
  current,
  currentLabel,
  onPress,
}: CompanyCardProps) {
  const theme = useTheme();
  const stats = [
    { icon: 'people-outline', label: employees },
    { icon: 'git-network-outline', label: managers },
    { icon: 'ribbon-outline', label: owners },
  ] as const;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: current }}
      onPress={onPress}
      style={{
        ...theme.shadow.soft,
        flexDirection: 'row',
        alignItems: 'center',
        padding: theme.spacing.md,
        gap: theme.spacing.md,
        borderRadius: theme.radius.lg,
        borderWidth: current ? 1.5 : 1,
        borderColor: current ? theme.color.brand : theme.color.border,
        backgroundColor: current ? theme.color.brandSoft : theme.color.surface,
      }}
    >
      <Image
        source={logo ? { uri: logo } : BUILDING_ART}
        resizeMode={logo ? 'contain' : 'cover'}
        style={{ width: 64, height: 64, borderRadius: 14 }}
      />
      <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.xs }}>
        <Text style={{ fontWeight: '700' }}>{name}</Text>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.spacing.xs,
          }}
        >
          {stats.map(({ icon, label }, index) => (
            <View
              key={icon}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                maxWidth: '100%',
                gap: theme.spacing.xs,
              }}
            >
              {index > 0 ? (
                <View
                  style={{
                    width: 3,
                    height: 3,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.color.textMuted,
                  }}
                />
              ) : null}
              <Ionicons name={icon} size={14} color={theme.color.textMuted} />
              <Text variant="micro" tone="muted" style={{ flexShrink: 1 }}>
                {label}
              </Text>
            </View>
          ))}
        </View>
        {current ? (
          <View
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: theme.spacing.xs,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.brand,
              }}
            />
            <Text variant="micro" style={{ color: theme.color.brand, flexShrink: 1 }}>
              {currentLabel}
            </Text>
          </View>
        ) : null}
      </View>
      <Ionicons name={directionalIcon('chevron-forward')} size={20} color={theme.color.textMuted} />
    </Pressable>
  );
}
