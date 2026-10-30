import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, iconSize, useTheme } from '@waves/ui';

import { BLUE, BLUE_SOFT, GREEN, GREEN_SOFT } from './parts';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonAvatar, type PersonAvatarProps } from '@/components/PersonAvatar';

export type EmployeeStatus = {
  kind: 'settled' | 'companyOwes' | 'owesCompany';
  label: string;
};

export function EmployeeRow({
  member,
  name,
  ghost,
  status,
  marker,
  menuItems,
  menuLabel,
  onPress,
  divider,
  muted = false,
}: {
  member: PersonAvatarProps['member'];
  name: string;
  ghost?: boolean;
  status: EmployeeStatus;
  marker?: string;
  menuItems: readonly OverflowMenuItem[];
  menuLabel: string;
  onPress: () => void;
  divider: boolean;
  muted?: boolean;
}) {
  const theme = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const settled = status.kind === 'settled';
  const backgroundColor = muted
    ? theme.color.surfaceMuted
    : settled
      ? GREEN_SOFT
      : status.kind === 'companyOwes'
        ? BLUE_SOFT
        : '#FEF3C7';
  const color = muted
    ? theme.color.textMuted
    : settled
      ? GREEN
      : status.kind === 'companyOwes'
        ? BLUE
        : '#B45309';

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 56,
          paddingVertical: 8,
          borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: theme.color.border,
          opacity: muted ? 0.62 : 1,
        }}
      >
        <PersonAvatar member={member} name={name} ghost={ghost} size={40} />
        <View style={{ flex: 1, minWidth: 0, marginStart: 12, gap: 4 }}>
          <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
            {name}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: theme.radius.pill,
                backgroundColor,
              }}
            >
              {settled && !muted && <Ionicons name="checkmark-circle" size={12} color={GREEN} />}
              <Text variant="micro" style={{ color }}>
                {status.label}
              </Text>
            </View>
            {marker ? (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.surfaceMuted,
                }}
              >
                <Text variant="micro" tone="muted">
                  {marker}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={menuLabel}
          onPress={(event) => {
            event.stopPropagation();
            setMenuOpen(true);
          }}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="ellipsis-vertical" size={iconSize.md} color={theme.color.textMuted} />
        </Pressable>
      </Pressable>
      <OverflowMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
    </>
  );
}
