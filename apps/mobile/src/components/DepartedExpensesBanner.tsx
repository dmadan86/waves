import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { Button, Card, IconButton, Row, Text, tintForKey, useTheme } from '@waves/ui';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useGroup, useGroupLedger } from '@/data/hooks';
import { displayName, type MemberRow } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { classifyDepartedExpenses } from '@/lib/departedExpenses';
import { useDismissed } from '@/lib/dismissed';
import { router } from '@/lib/navigation';

function DepartedBanner({
  groupId,
  member,
  count,
}: {
  groupId: string;
  member: MemberRow;
  count: number;
}) {
  const theme = useTheme();
  const viewerId = useViewerId();
  const { dismissed, dismiss } = useDismissed(`departed.${groupId}.${member.id}`, viewerId);
  const { t, locale } = useStrings();
  const name = displayName(member, null, undefined, t.misc.someone);
  const tint = tintForKey(name);
  const color = theme.tint[tint];
  if (dismissed !== false) return null;
  return (
    <Card
      padded={false}
      flat
      style={{
        paddingVertical: theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.radius.sm,
        backgroundColor: `${color.bg}40`,
        borderColor: `${color.bg}99`,
        borderWidth: 1,
      }}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <PersonAvatar name={name} tint={tint} size={28} />
        <Text numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1, minWidth: 0 }}>
          {fill(plural(locale, count, t.departedExpenses.banner), { name })}
        </Text>
        <Button
          size="sm"
          variant="brand"
          label={t.departedExpenses.decide}
          onPress={() => router.push(`/group/${groupId}/departed/${member.id}`)}
          style={{ paddingHorizontal: theme.spacing.md }}
        />
        <IconButton label={t.departedExpenses.keepAsIs} onPress={dismiss}>
          <Ionicons name="close" size={16} color={theme.color.textMuted} />
        </IconButton>
      </Row>
    </Card>
  );
}

export function DepartedExpensesBanner({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const viewerId = useViewerId();
  const { members, everyone, expenses } = useGroup(groupId);
  const ledger = useGroupLedger(groupId, viewerId);
  if (!members.data?.some((m) => m.id === ledger.myMemberId && m.role === 'admin' && !m.left_at))
    return null;
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {everyone.data
        ?.filter(
          (m) =>
            m.left_at &&
            [...ledger.net.values()].some((balances) => (balances.get(m.id) ?? 0n) !== 0n),
        )
        .map((member) => {
          const { equal, custom } = classifyDepartedExpenses(expenses.rows, member.id);
          const count = equal.length + custom.filter((c) => !c.noneRemaining).length;
          return count ? (
            <DepartedBanner key={member.id} groupId={groupId} member={member} count={count} />
          ) : null;
        })}
    </View>
  );
}
