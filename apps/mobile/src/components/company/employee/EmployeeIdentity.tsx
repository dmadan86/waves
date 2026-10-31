/** The scenic header's identity block: big avatar with an active-today dot, name, ID and status pills, type and department chips. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View, useWindowDimensions } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { PersonAvatar } from '@/components/PersonAvatar';
import { GREEN, GREEN_SOFT } from '@/components/company/dashboard/parts';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import { isNotEmployed } from '@/data/companyEmployment';
import { useStrings } from '@/i18n';

const AVATAR = 76;

function Pill({
  label,
  fg,
  bg,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  fg: string;
  bg: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={6}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 3,
        maxWidth: 130,
        borderRadius: theme.radius.pill,
        backgroundColor: bg,
      }}
    >
      <Text variant="caption" numberOfLines={1} style={{ color: fg, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Chip({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 160 }}
    >
      <Ionicons name={icon} size={iconSize.base} color={theme.color.textMuted} />
      <Text variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      {onPress ? (
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.sm}
          color={theme.color.textMuted}
        />
      ) : null}
    </Pressable>
  );
}

export function EmployeeIdentity({
  member,
  activeToday,
  typeLabel,
  departmentLabel,
  onEditId,
  onPickType,
  onPickDepartment,
}: {
  member: MemberRow;
  activeToday: boolean;
  /** Already resolved ("Not set" when empty); null hides the chip (not an employee). */
  typeLabel: string | null;
  departmentLabel: string | null;
  /** Set when the viewer may edit; omitted = read-only. */
  onEditId?: () => void;
  onPickType?: () => void;
  onPickDepartment?: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { width } = useWindowDimensions();
  const name = displayName(member, null, null, t.misc.someone);
  const gone = isNotEmployed(member);
  const employee = member.role === 'member' || member.role === 'manager';
  return (
    <View
      style={{ width: width - theme.spacing.lg * 2, flexDirection: 'row', gap: theme.spacing.md }}
    >
      <View style={{ width: AVATAR, height: AVATAR }}>
        <PersonAvatar member={member} name={name} ghost={isGhost(member)} size={AVATAR} />
        {activeToday ? (
          <View
            accessibilityLabel={t.company.overviewActiveToday}
            style={{
              position: 'absolute',
              right: 2,
              bottom: 2,
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: GREEN,
              borderWidth: 2,
              borderColor: '#FFFFFF',
            }}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 6, justifyContent: 'center' }}>
        <Text
          variant="heading"
          accessibilityRole="header"
          numberOfLines={2}
          style={{ fontSize: 22, lineHeight: 27, fontWeight: '800' }}
        >
          {name}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          {member.employee_id ? (
            <Pill
              label={`#${member.employee_id}`}
              fg={theme.color.textMuted}
              bg={theme.color.brandSoft}
              onPress={onEditId}
              accessibilityLabel={`${t.company.employeeId} ${member.employee_id}`}
            />
          ) : onEditId ? (
            <Pill
              label={t.company.addEmployeeId}
              fg={theme.color.brand}
              bg={theme.color.brandSoft}
              onPress={onEditId}
            />
          ) : null}
          {employee ? (
            gone ? (
              <Pill
                label={t.company.notEmployed}
                fg={theme.color.textMuted}
                bg={theme.color.surfaceMuted}
              />
            ) : (
              <Pill
                label={t.company.statusActive}
                fg={GREEN}
                bg={theme.scheme === 'dark' ? 'rgba(21,128,61,0.18)' : GREEN_SOFT}
              />
            )
          ) : null}
        </View>
        {typeLabel !== null || departmentLabel !== null ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
            {typeLabel !== null ? (
              <Chip icon="briefcase" label={typeLabel} onPress={onPickType} />
            ) : null}
            {departmentLabel !== null ? (
              <Chip icon="people" label={departmentLabel} onPress={onPickDepartment} />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
