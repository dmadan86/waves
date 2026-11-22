/**
 * Home's body drawn from the stored snapshot while the live data is still
 * loading. Same cards, titles and rows as the live sections, so the swap to
 * live data changes figures in place rather than reshaping the screen.
 */

import { View } from 'react-native';

import { useTheme } from '@waves/ui';

import { GroupRowView } from '@/components/home/HomeSpaces';
import { CardTitle } from '@/components/personal/PersonalHomeParts';
import { useStrings } from '@/i18n';
import type { HomeSnapshot, SnapRow } from '@/lib/homeSnapshot';
import { router } from '@/lib/navigation';

export function HomeSnapshotView({
  snapshot,
  hidden,
  locale,
}: {
  snapshot: HomeSnapshot;
  hidden: boolean;
  locale: string;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const h = t.homeToday;
  const card = {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
    overflow: 'hidden',
  } as const;
  const list = (rows: readonly SnapRow[], divider0: boolean) => (
    <View style={card}>
      {rows.map((row, i) => (
        <GroupRowView
          key={row.key}
          row={row}
          locale={locale}
          hidden={hidden}
          divider={i > 0 || divider0}
          tagTone={row.isDemo ? 'warning' : 'brand'}
        />
      ))}
    </View>
  );
  const spaces = snapshot.personal ? [snapshot.personal, ...snapshot.groups] : snapshot.groups;
  return (
    <View style={{ paddingTop: theme.spacing.sm, gap: theme.spacing.lg }}>
      {snapshot.needs.length ? (
        <View style={{ gap: theme.spacing.sm }}>
          <CardTitle title={h.needsYou} />
          {list(snapshot.needs, false)}
        </View>
      ) : null}
      {snapshot.comingUp.length ? (
        <View style={{ gap: theme.spacing.sm }}>
          <CardTitle title={h.comingUp} />
          {list(snapshot.comingUp, false)}
        </View>
      ) : null}
      <View style={{ gap: theme.spacing.sm }}>
        <CardTitle title={h.spaces} action={h.seeAll} onAction={() => router.navigate('/groups')} />
        {list(spaces, false)}
      </View>
    </View>
  );
}
