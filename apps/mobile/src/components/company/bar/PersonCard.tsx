import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View, useWindowDimensions } from 'react-native';

import { Text, iconSize, useTheme } from '@waves/ui';

import { withAlpha } from '@/components/company/dashboard/overviewKit';
import { BLUE, BLUE_SOFT } from '@/components/company/dashboard/parts';
import { PersonAvatar, type PersonAvatarProps } from '@/components/PersonAvatar';
import { balanceTone, type Balance, type PersonRole } from '@/data/companyPeople';
import type { AttendanceStatus } from '@/data/companyWorkday';
import { useStrings } from '@/i18n';

export type PersonStatus = 'active' | 'leave' | 'inactive';

/** One person in the People list: a row of the shared card, sized like the Home group rows. */
export function PersonCard({
  member,
  name,
  ghost,
  role,
  employeeId,
  mark,
  showMark,
  tasks,
  balance,
  balanceText,
  note,
  status,
  muted,
  divider,
  onPress,
}: {
  member: PersonAvatarProps['member'];
  name: string;
  ghost?: boolean;
  role: PersonRole;
  employeeId?: string | null;
  mark: AttendanceStatus | null;
  /** False for owners and people no longer employed: there is no mark to show. */
  showMark: boolean;
  tasks: string;
  balance: Balance | null;
  balanceText: string;
  /** A muted line-end note (the date someone left). */
  note?: string;
  status: PersonStatus;
  muted?: boolean;
  /** A hairline above the row, for every row but the first. */
  divider?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const narrow = useWindowDimensions().width < 360;
  const c = theme.color;
  const markSpec = {
    present: { label: t.company.attendancePresent, fg: c.positive },
    half: { label: t.company.attHalfDay, fg: c.warning },
    absent: { label: t.company.attendanceAbsent, fg: c.negative },
    none: { label: t.company.attNotMarked, fg: c.warning },
  }[mark ?? 'none'];
  const rolePill = {
    employee: { label: t.company.roleEmployee, fg: c.brand, bg: c.brandSoft },
    manager: { label: t.company.manager, fg: BLUE, bg: BLUE_SOFT },
    owner: { label: t.company.pillOwner, fg: c.text, bg: c.surfaceMuted },
  }[role];
  // Just the coloured dot: the word repeated on every row read as noise.
  const markDot = (
    <View
      accessible
      accessibilityLabel={markSpec.label}
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: markSpec.fg,
        flexShrink: 0,
      }}
    />
  );
  const pill = {
    active: { label: t.company.statusActive, fg: c.positive },
    leave: { label: t.company.overviewOnLeave, fg: c.warning },
    inactive: { label: t.company.notEmployed, fg: c.textMuted },
  }[status];
  const tone = balance ? c[balanceTone(balance)] : c.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        showMark ? `${name}, ${pill.label}, ${markSpec.label}` : `${name}, ${pill.label}`
      }
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.sm,
        borderTopWidth: divider ? 1 : 0,
        borderTopColor: c.border,
        opacity: pressed ? 0.6 : muted ? 0.62 : 1,
      })}
    >
      <PersonAvatar member={member} name={name} ghost={ghost} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="body" numberOfLines={1} style={{ fontWeight: '700', flexShrink: 1 }}>
            {name}
          </Text>
          {showMark ? markDot : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              flexShrink: 1,
              minWidth: 0,
              paddingHorizontal: 8,
              paddingVertical: 1,
              borderRadius: theme.radius.pill,
              backgroundColor: rolePill.bg,
            }}
          >
            <Text variant="micro" numberOfLines={1} style={{ color: rolePill.fg }}>
              {rolePill.label}
            </Text>
          </View>
          {(employeeId || note) && !narrow ? (
            <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {'· '}
              {employeeId ?? note}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4, maxWidth: 110 }}>
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 2,
            borderRadius: theme.radius.pill,
            backgroundColor: withAlpha(pill.fg, 0.14),
          }}
        >
          <Text variant="micro" numberOfLines={1} style={{ color: pill.fg, fontWeight: '600' }}>
            {pill.label}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="reader-outline" size={iconSize.sm} color={c.textMuted} />
          <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {tasks}
          </Text>
        </View>
        {balance ? (
          <Text variant="caption" numberOfLines={1} style={{ color: tone, fontWeight: '700' }}>
            {balanceText}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
