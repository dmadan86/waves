import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { iconSize, Text, useTheme } from '@waves/ui';
import { AMBER, IconDisc, RED } from '@/components/company/dashboard/overviewKit';
import { GREEN } from '@/components/company/dashboard/parts';
import { StandardCard } from '@/components/standard';
import { useStrings } from '@/i18n';

/** Four equal count tiles over the task list. Not tappable: no matching filter exists. */
export function TaskStatTiles({
  all,
  overdue,
  dueToday,
  completed,
}: {
  all: number;
  overdue: number;
  dueToday: number;
  completed: number;
}) {
  const { t } = useStrings();
  const theme = useTheme();
  const tiles = [
    { n: all, label: t.company.workAllTasks, icon: 'checkbox-outline', ink: '#7C5CFC' },
    { n: overdue, label: t.company.workOverdue, icon: 'alert-circle-outline', ink: RED },
    { n: dueToday, label: t.company.workDueToday, icon: 'calendar-outline', ink: AMBER },
    { n: completed, label: t.company.workCompleted, icon: 'checkmark-circle-outline', ink: GREEN },
  ] as const;
  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
      {tiles.map((tile) => (
        <View
          key={tile.label}
          accessible
          accessibilityLabel={`${tile.label}: ${tile.n}`}
          style={{ flex: 1, minWidth: 0 }}
        >
          <StandardCard style={{ padding: theme.spacing.sm, gap: 4, alignItems: 'center' }}>
            <IconDisc ink={tile.ink} size={30}>
              <Ionicons name={tile.icon} size={iconSize.sm} color={tile.ink} />
            </IconDisc>
            <Text variant="heading" style={{ fontWeight: '800' }}>
              {tile.n}
            </Text>
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {tile.label}
            </Text>
          </StandardCard>
        </View>
      ))}
    </View>
  );
}
