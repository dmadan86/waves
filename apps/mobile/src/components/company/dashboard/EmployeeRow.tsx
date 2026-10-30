import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, iconSize, useTheme } from '@waves/ui';

import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonAvatar, type PersonAvatarProps } from '@/components/PersonAvatar';
import { AttendancePill, BalanceText, TaskCount } from '@/components/company/bar/PeopleParts';
import type { Balance } from '@/data/companyPeople';
import type { AttendanceStatus } from '@/data/companyWorkday';

/**
 * One person in the People list: avatar, name, "Full-time · Marketing", today's attendance, then a meta line
 * (open tasks, balance, employee ID or "All settled"). `compact` is the shorter row inside a manager's team.
 */
export function EmployeeRow({
  member,
  name,
  ghost,
  subtitle,
  attendance,
  tasks,
  balance,
  balanceText,
  chip,
  menuItems,
  menuLabel,
  onPress,
  divider,
  muted = false,
  compact = false,
}: {
  member: PersonAvatarProps['member'];
  name: string;
  ghost?: boolean;
  subtitle?: string;
  attendance?: AttendanceStatus | null;
  tasks?: string;
  balance?: Balance;
  balanceText?: string;
  /** The trailing chip: the employee ID, else "All settled". */
  chip?: string;
  menuItems: readonly OverflowMenuItem[];
  menuLabel: string;
  onPress: () => void;
  divider: boolean;
  muted?: boolean;
  compact?: boolean;
}) {
  const theme = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = (
    <>
      {tasks ? <TaskCount text={tasks} /> : null}
      {balance && balanceText ? <BalanceText balance={balance} text={balanceText} /> : null}
    </>
  );
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: compact ? 48 : 56,
          paddingVertical: compact ? 6 : 8,
          borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: theme.color.border,
          opacity: muted ? 0.62 : 1,
        }}
      >
        <PersonAvatar member={member} name={name} ghost={ghost} size={compact ? 34 : 40} />
        <View style={{ flex: 1, minWidth: 0, marginStart: 12, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="body" numberOfLines={1} style={{ fontWeight: '600', flexShrink: 1 }}>
              {name}
            </Text>
            {compact ? null : (
              <View style={{ marginStart: 'auto' }}>
                <AttendancePill status={attendance ?? null} />
              </View>
            )}
          </View>
          {subtitle && !compact ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          {compact ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AttendancePill status={attendance ?? null} />
              {meta}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 20 }}>
              {meta}
              {chip ? (
                <View
                  style={{
                    marginStart: 'auto',
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.color.surfaceMuted,
                  }}
                >
                  <Text variant="micro" tone="muted">
                    {chip}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={menuLabel}
          onPress={(event) => {
            event.stopPropagation();
            setMenuOpen(true);
          }}
          style={{ width: 36, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="ellipsis-vertical" size={iconSize.md} color={theme.color.textMuted} />
        </Pressable>
      </Pressable>
      <OverflowMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
    </>
  );
}
