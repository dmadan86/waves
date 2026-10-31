import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { iconSize, Text, useTheme } from '@waves/ui';
import { PersonAvatar, type PersonAvatarProps } from '@/components/PersonAvatar';
import type { AttendanceStatus } from '@/data/companyWorkday';

export const GREEN = '#15803D',
  AMBER = '#B45309',
  RED = '#DC2626';

/** One compact row: avatar, name + ID (+ leave / half-day chip) and the Present | Absent control. */
export function AttendanceRow({
  member,
  name,
  ghost,
  subtitle,
  status,
  leave,
  chip,
  hasNote,
  canEdit,
  labels,
  onMark,
  onOpen,
  divider,
}: {
  member: PersonAvatarProps['member'];
  name: string;
  ghost?: boolean;
  /** The employee ID. */
  subtitle: string;
  status: AttendanceStatus | undefined;
  /** Approved leave locks the control; applied (pending) leave only adds a chip. */
  leave: 'approved' | 'pending' | null;
  /** Half-day: neither side of the control is selected, so say so. */
  chip: string | null;
  hasNote: boolean;
  canEdit: boolean;
  labels: { present: string; absent: string; onLeave: string; leaveApplied: string; leave: string };
  onMark: (status: 'present' | 'absent') => void;
  /** Row tap: the full status sheet (half day, clear, note, statement). */
  onOpen: () => void;
  divider: boolean;
}) {
  const theme = useTheme();
  const chipText =
    leave === 'approved' ? labels.onLeave : leave === 'pending' ? labels.leaveApplied : chip;
  const chipColor = leave === 'approved' ? '#1D4ED8' : AMBER;
  const seg = (which: 'present' | 'absent') => {
    const on = status === which,
      green = which === 'present';
    const ink = on ? (green ? '#FFFFFF' : RED) : theme.color.text;
    return (
      <Pressable
        key={which}
        accessibilityRole="button"
        accessibilityState={{ selected: on, disabled: !canEdit }}
        disabled={!canEdit}
        onPress={() => onMark(which)}
        style={{
          paddingHorizontal: 12,
          height: 32,
          minWidth: 62,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 16,
          borderWidth: on && !green ? 1.5 : 0,
          borderColor: RED,
          backgroundColor: on ? (green ? GREEN : `${RED}14`) : 'transparent',
        }}
      >
        <Text variant="caption" style={{ color: ink, fontWeight: '700' }}>
          {green ? labels.present : labels.absent}
        </Text>
      </Pressable>
    );
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onOpen}
      onLongPress={onOpen}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: theme.color.border,
      }}
    >
      <PersonAvatar member={member} name={name} ghost={ghost} size={36} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text numberOfLines={1} style={{ fontWeight: '700', flexShrink: 1 }}>
            {name}
          </Text>
          {hasNote ? (
            <Ionicons name="chatbox-ellipses" size={iconSize.sm} color={theme.color.textMuted} />
          ) : null}
        </View>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {chipText ? (
          <View
            style={{
              alignSelf: 'flex-start',
              marginTop: 2,
              paddingHorizontal: 8,
              paddingVertical: 1,
              borderRadius: theme.radius.pill,
              backgroundColor: `${chipColor}1A`,
            }}
          >
            <Text variant="micro" numberOfLines={1} style={{ color: chipColor, fontWeight: '700' }}>
              {chipText}
            </Text>
          </View>
        ) : null}
      </View>
      {leave === 'approved' ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            height: 32,
            paddingHorizontal: 12,
            borderRadius: 16,
            backgroundColor: theme.color.surfaceMuted,
          }}
        >
          <Ionicons name="lock-closed" size={iconSize.sm} color={theme.color.textMuted} />
          <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
            {labels.leave}
          </Text>
        </View>
      ) : (
        <View
          style={{
            flexDirection: 'row',
            borderRadius: 18,
            padding: 2,
            borderWidth: 1,
            borderColor: theme.color.border,
            backgroundColor: theme.color.surfaceMuted,
          }}
        >
          {seg('present')}
          {seg('absent')}
        </View>
      )}
    </Pressable>
  );
}
