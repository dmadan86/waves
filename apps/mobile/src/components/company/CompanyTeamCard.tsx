/**
 * Owner-only controls on one person's statement: make them a manager (one tap),
 * choose who they report to, and which sites they work on. The "Reports to" row only
 * appears once a manager exists, and sites only once a site exists, so a small crew
 * never sees either.
 */

import { View } from 'react-native';

import { Chip, ChipRow, Text, Toggle, useTheme } from '@waves/ui';

import { ListRow, StandardCard } from '@/components/standard';
import {
  useAssignCompanyMember,
  useCompanyProjectMembers,
  useCompanyProjects,
  useSetMemberProjects,
  type CompanyView,
} from '@/data/companyEntries';
import { useSetMemberRole } from '@/data/hooks';
import { displayName, type MemberRow } from '@/data/types';
import { useStrings } from '@/i18n';

export function CompanyTeamCard({
  groupId,
  view,
  member,
}: {
  groupId: string;
  view: CompanyView;
  member: MemberRow;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const role = useSetMemberRole(groupId);
  const assign = useAssignCompanyMember(groupId);
  const setProjects = useSetMemberProjects(groupId);
  const projects = useCompanyProjects(groupId).filter((p) => !p.archived_at);
  const onSites = useCompanyProjectMembers(groupId).get(member.id) ?? [];
  if (!view.isOwner || member.id === view.me?.id || member.role === 'admin') return null;

  const managers = view.members.filter((m) => m.role === 'manager' && !m.left_at);
  const hasTeam = view.members.some((m) => m.manager_id === member.id && !m.left_at);
  const isManager = member.role === 'manager';

  return (
    <StandardCard style={{ gap: theme.spacing.md }}>
      <ListRow
        title={t.company.canPayPeople}
        subtitle={isManager && hasTeam ? t.company.moveTeamFirst : undefined}
        trailing={
          <Toggle
            value={isManager}
            disabled={role.isPending || (isManager && hasTeam)}
            onValueChange={(on) =>
              role.mutate({ memberId: member.id, role: on ? 'manager' : 'member' })
            }
            accessibilityLabel={t.company.canPayPeople}
          />
        }
      />
      {!isManager && managers.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="caption" tone="muted">
            {t.company.reportsTo}
          </Text>
          <ChipRow
            wrap
            onCard
            options={[
              { value: '', label: t.company.owners },
              ...managers.map((m) => ({
                value: m.id as string,
                label: displayName(m, null, null, t.misc.someone),
              })),
            ]}
            value={member.manager_id ?? ''}
            onChange={(next) => {
              if ((next || null) === (member.manager_id ?? null)) return;
              assign.mutate({ memberId: member.id, managerId: next || null, reason: '' });
            }}
          />
          <Text variant="caption" tone="muted">
            {t.company.historyMoves}
          </Text>
        </View>
      ) : null}
      {!isManager && projects.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="caption" tone="muted">
            {t.company.sites}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {projects.map((p) => {
              const on = onSites.includes(p.id);
              return (
                <Chip
                  key={p.id}
                  label={p.name}
                  selected={on}
                  onCard
                  repeatable
                  onPress={() =>
                    setProjects.mutate({
                      memberId: member.id,
                      projectIds: on ? onSites.filter((id) => id !== p.id) : [...onSites, p.id],
                    })
                  }
                />
              );
            })}
          </View>
        </View>
      ) : null}
    </StandardCard>
  );
}
