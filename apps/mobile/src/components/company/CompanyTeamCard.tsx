/**
 * Owner-only controls on one person's statement: make them a manager (one tap),
 * choose who they report to, and which sites they work on. The "Reports to" row only
 * appears once a manager exists, and sites only once a site exists, so a small crew
 * never sees either.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Chip, iconSize, Text, Toggle, useTheme } from '@waves/ui';

import { ListRow, PILL_SELECTED, StandardCard } from '@/components/standard';
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name="shield-checkmark-outline" size={iconSize.lg} color={theme.color.brand} />
        <Text variant="heading" accessibilityRole="header" style={{ fontSize: 18 }}>
          {t.company.permissions}
        </Text>
      </View>
      <ListRow
        title={t.company.canPayPeople}
        subtitle={isManager && hasTeam ? t.company.moveTeamFirst : t.company.canPayPeopleHint}
        subtitleLines={2}
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
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Ionicons name="git-network-outline" size={iconSize.md} color={theme.color.brand} />
            <Text variant="body" style={{ fontWeight: '700' }}>
              {t.company.reportsTo}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {[
              { value: '', label: t.company.owners },
              ...managers.map((m) => ({
                value: m.id as string,
                label: displayName(m, null, null, t.misc.someone),
              })),
            ].map((o) => {
              const on = o.value === (member.manager_id ?? '');
              return (
                <Pressable
                  key={o.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  disabled={assign.isPending}
                  onPress={() => {
                    if (on) return;
                    assign.mutate({ memberId: member.id, managerId: o.value || null, reason: '' });
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    height: 36,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.pill,
                    backgroundColor: on ? PILL_SELECTED : theme.color.brandSoft,
                  }}
                >
                  {on ? <Ionicons name="checkmark" size={iconSize.base} color="#FFFFFF" /> : null}
                  <Text
                    variant="caption"
                    style={{ fontWeight: '600', color: on ? '#FFFFFF' : theme.color.text }}
                  >
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons
              name="information-circle-outline"
              size={iconSize.base}
              color={theme.color.textMuted}
            />
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              {t.company.historyMoves}
            </Text>
          </View>
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
