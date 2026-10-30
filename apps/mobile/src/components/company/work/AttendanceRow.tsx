import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, iconSize, useTheme } from '@waves/ui';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonAvatar, type PersonAvatarProps } from '@/components/PersonAvatar';
import type { AttendanceStatus } from '@/data/companyWorkday';

export const GREEN = '#15803D',
  AMBER = '#B45309',
  RED = '#DC2626';

/** Colour and glyph of the status pill; no status is the neutral "Mark". */
export function statusLook(status: AttendanceStatus | undefined) {
  return status === 'present'
    ? { color: GREEN, icon: 'checkmark-circle' as const }
    : status === 'half'
      ? { color: AMBER, icon: 'contrast' as const }
      : status === 'absent'
        ? { color: RED, icon: 'remove-circle' as const }
        : null;
}

export function AttendanceRow({
  member,
  name,
  ghost,
  subtitle,
  chip,
  status,
  statusLabel,
  tasksLabel,
  balance,
  menuItems,
  menuLabel,
  noteLabel,
  canEdit,
  hasNote,
  onStatus,
  onNote,
  divider,
}: {
  member: PersonAvatarProps['member'];
  name: string;
  ghost?: boolean;
  subtitle: string;
  chip: string | null;
  status: AttendanceStatus | undefined;
  statusLabel: string;
  tasksLabel: string;
  /** Who owes whom: red up-arrow when the person owes the company, blue down-arrow when it owes them. */
  balance: { kind: 'settled' | 'companyOwes' | 'owesCompany'; text: string };
  menuItems: readonly OverflowMenuItem[];
  menuLabel: string;
  noteLabel: string;
  canEdit: boolean;
  hasNote: boolean;
  onStatus: () => void;
  onNote: () => void;
  divider: boolean;
}) {
  const theme = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const look = statusLook(status);
  const pill = look?.color ?? theme.color.textMuted;
  const owes = balance.kind === 'owesCompany';
  const balanceColor = owes ? RED : balance.kind === 'companyOwes' ? theme.color.brand : GREEN;
  return (
    <View
      style={{
        gap: 8,
        padding: 12,
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: theme.color.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <PersonAvatar member={member} name={name} ghost={ghost} size={42} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text numberOfLines={2} style={{ fontWeight: '700' }}>
            {name}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={statusLabel}
            disabled={!canEdit}
            onPress={onStatus}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 8,
              minHeight: 32,
              borderRadius: theme.radius.pill,
              backgroundColor: `${pill}22`,
            }}
          >
            {look ? <Ionicons name={look.icon} size={16} color={pill} /> : null}
            <Text variant="caption" numberOfLines={1} style={{ color: pill, fontWeight: '700' }}>
              {statusLabel}
            </Text>
            <Ionicons name="chevron-down" size={12} color={pill} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={noteLabel}
            disabled={!status || !canEdit}
            onPress={onNote}
            hitSlop={6}
            style={{ width: 28, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons
              name={hasNote ? 'chatbox-ellipses' : 'chatbox-outline'}
              size={20}
              color={theme.color.textMuted}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={menuLabel}
            onPress={() => setMenuOpen(true)}
            hitSlop={6}
            style={{ width: 24, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="ellipsis-vertical" size={iconSize.md} color={theme.color.textMuted} />
          </Pressable>
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          marginStart: 52,
        }}
      >
        {chip ? (
          <View
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.surfaceMuted,
            }}
          >
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {chip}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Ionicons name="list-outline" size={14} color={theme.color.textMuted} />
            <Text variant="micro" tone="muted">
              {tasksLabel}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Ionicons
              name={balance.kind === 'companyOwes' ? 'arrow-down' : 'arrow-up'}
              size={13}
              color={balanceColor}
            />
            <Text variant="micro" numberOfLines={1} style={{ color: balanceColor, flexShrink: 1 }}>
              {balance.text}
            </Text>
          </View>
        </View>
      </View>
      <OverflowMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
    </View>
  );
}
