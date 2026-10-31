import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, iconSize, useTheme } from '@waves/ui';

import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { type MenuAnchor } from '@/components/SortMenu';
import { PersonAvatar, type PersonAvatarProps } from '@/components/PersonAvatar';
import { AttendancePill, BalanceText, TaskCount } from '@/components/company/bar/PeopleParts';
import type { Balance } from '@/data/companyPeople';
import type { AttendanceStatus } from '@/data/companyWorkday';
import { measureAnchor } from '@/lib/measureAnchor';

/**
 * One person in the People list: avatar, name, "Full-time · Marketing", today's attendance, then a meta line
 * (open tasks, balance or "All settled"). `compact` is the shorter row inside a manager's team.
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
  employeeId,
  note,
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
  /** Muted, small, right after the name; never wraps (the name ellipsizes first). */
  employeeId?: string | null;
  /** A muted line-end note (e.g. the date someone left). */
  note?: string;
  menuItems: readonly OverflowMenuItem[];
  menuLabel: string;
  onPress: () => void;
  divider: boolean;
  muted?: boolean;
  compact?: boolean;
}) {
  const theme = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const dotsRef = useRef<View>(null);
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
            {employeeId ? (
              <Text
                variant="micro"
                tone="muted"
                numberOfLines={1}
                style={{ flexShrink: 0, maxWidth: 110 }}
              >
                {'· '}
                {employeeId}
              </Text>
            ) : null}
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
              {note ? (
                <Text variant="micro" tone="muted">
                  {note}
                </Text>
              ) : null}
            </View>
          )}
        </View>
        <Pressable
          ref={dotsRef}
          accessibilityRole="button"
          accessibilityLabel={menuLabel}
          onPress={(event) => {
            event.stopPropagation();
            measureAnchor(dotsRef, (a) => {
              setAnchor(a);
              setMenuOpen(true);
            });
          }}
          style={{ width: 36, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="ellipsis-vertical" size={iconSize.md} color={theme.color.textMuted} />
        </Pressable>
      </Pressable>
      <OverflowMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        anchor={anchor}
      />
    </>
  );
}
