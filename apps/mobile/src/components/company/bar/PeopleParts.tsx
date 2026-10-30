/** Small pieces of the People screen: stat chips, today's attendance pill, tasks and balance meta. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Text, iconSize, useTheme } from '@waves/ui';

import type { Balance } from '@/data/companyPeople';
import type { AttendanceStatus } from '@/data/companyWorkday';
import { useStrings } from '@/i18n';

/** The headline numbers under the header: employed people only. */
export function StatChips({
  items,
}: {
  items: readonly { icon: keyof typeof Ionicons.glyphMap; count: number; label: string }[];
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
      {items.map((item) => (
        <View
          key={item.label}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            padding: 10,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.border,
          }}
        >
          <Ionicons name={item.icon} size={iconSize.lg} color={theme.color.brand} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="heading" style={{ fontWeight: '800' }}>
              {item.count}
            </Text>
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {item.label}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Today's mark: green present, amber half day, red absent. Nothing when not marked. */
export function AttendancePill({ status }: { status: AttendanceStatus | null }) {
  const theme = useTheme();
  const { t } = useStrings();
  if (!status) return null;
  const spec = {
    present: {
      label: t.company.attendancePresent,
      icon: 'checkmark-circle',
      fg: theme.color.positive,
      bg: theme.color.positiveSoft,
    },
    half: {
      label: t.company.attHalfDay,
      icon: 'time',
      fg: theme.color.warning,
      bg: theme.color.warningSoft,
    },
    absent: {
      label: t.company.attendanceAbsent,
      icon: 'close-circle',
      fg: theme.color.negative,
      bg: theme.color.negativeSoft,
    },
  } as const;
  const { label, icon, fg, bg } = spec[status];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: theme.radius.pill,
        backgroundColor: bg,
      }}
    >
      <Ionicons name={icon} size={12} color={fg} />
      <Text variant="micro" style={{ color: fg, fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}

/** Balance with its direction: green up = settled or nothing owed, red up = owes the company, green down = the company owes them. */
export function BalanceText({ balance, text }: { balance: Balance; text: string }) {
  const theme = useTheme();
  const owes = balance.kind === 'owesCompany';
  const color = owes ? theme.color.negative : theme.color.positive;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Ionicons
        name={balance.kind === 'companyOwes' ? 'arrow-down' : 'arrow-up'}
        size={12}
        color={color}
      />
      <Text variant="micro" style={{ color, fontWeight: '600' }}>
        {text}
      </Text>
    </View>
  );
}

export function TaskCount({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name="checkbox-outline" size={12} color={theme.color.textMuted} />
      <Text variant="micro" tone="muted">
        {text}
      </Text>
    </View>
  );
}
