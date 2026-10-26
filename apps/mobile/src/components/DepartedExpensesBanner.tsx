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
      flat
      style={{
        padding: theme.spacing.md,
        backgroundColor: `${color.bg}40`,
        borderColor: `${color.bg}99`,
        borderWidth: 1,
      }}
    >
      <Row style={{ alignItems: 'flex-start', gap: theme.spacing.md }}>
        <PersonAvatar name={name} tint={tint} size={40} />
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <Text variant="subheading" style={{ paddingEnd: theme.spacing.xxl }}>
            {fill(plural(locale, count, t.departedExpenses.banner), { name })}
          </Text>
          <Text variant="caption" tone="muted">
            {fill(plural(locale, count, t.departedExpenses.bannerExplainer), { name })}
          </Text>
          <Row style={{ gap: theme.spacing.sm, flexWrap: 'wrap', marginTop: theme.spacing.xs }}>
            <Button
              size="sm"
              variant="brand"
              label={t.departedExpenses.decide}
              onPress={() => router.push(`/group/${groupId}/departed/${member.id}`)}
            />
            <Button
              size="sm"
              variant="ghost"
              label={t.departedExpenses.keepAsIs}
              onPress={dismiss}
              style={{ borderWidth: 1, borderColor: theme.color.brandSoft }}
            />
          </Row>
        </View>
      </Row>
      <View style={{ position: 'absolute', top: theme.spacing.xs, end: theme.spacing.xs }}>
        <IconButton label={t.common.close} onPress={dismiss}>
          <Ionicons name="close" size={20} color={theme.color.textMuted} />
        </IconButton>
      </View>
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
