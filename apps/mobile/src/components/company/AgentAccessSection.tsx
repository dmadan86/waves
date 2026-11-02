/**
 * Owner's "AI agents" card in company settings: the master switch, whether agent changes need approval, who has
 * connected an assistant (revocable) and what agents have done. Online-only: it reads and writes the company-agent RPCs
 * directly; the server enforces owner-only, this is rendered for the owner alone.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';

import { Button, Text, Toggle, iconSize, useTheme } from '@waves/ui';

import { OverflowMenu } from '@/components/OverflowMenu';
import { ListRow, StandardCard } from '@/components/standard';
import { fill, useStrings } from '@/i18n';
import { backend } from '@/lib/backend';

interface AgentLink {
  id: string;
  name: string;
  clientId: string;
  lastUsedAt: string | null;
}
interface AgentState {
  enabled: boolean;
  approval: boolean;
  links: AgentLink[];
}
interface AgentWrite {
  id: string;
  person: string;
  action: string;
  created_at: string;
}

export function AgentAccessSection({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const queryClient = useQueryClient();
  const [menuLink, setMenuLink] = useState<AgentLink | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const key = ['company-agents', groupId];

  const state = useQuery({
    queryKey: key,
    queryFn: async (): Promise<AgentState> => {
      const { data, error } = await backend.rpc('waves_company_agent_links_list', {
        p_group_id: groupId,
      });
      if (error) throw error;
      return data as AgentState;
    },
  });
  const activity = useQuery({
    queryKey: [...key, 'writes'],
    enabled: showActivity,
    queryFn: async (): Promise<AgentWrite[]> => {
      const { data, error } = await backend.rpc('waves_company_agent_writes', {
        p_group_id: groupId,
        p_limit: 30,
      });
      if (error) throw error;
      return (data ?? []) as AgentWrite[];
    },
  });
  const save = useMutation({
    mutationFn: async (next: { enabled: boolean; approval: boolean }) => {
      const { error } = await backend.rpc('waves_company_agent_settings_set', {
        p_group_id: groupId,
        p_enabled: next.enabled,
        p_approval: next.approval,
      });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const revoke = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await backend.rpc('waves_company_agent_link_revoke', { p_link_id: linkId });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  if (!state.data) return null;
  const { enabled, approval, links } = state.data;
  const lead = (name: keyof typeof Ionicons.glyphMap) => (
    <Ionicons name={name} size={iconSize.lg} color={theme.color.textMuted} />
  );
  return (
    <>
      <StandardCard style={{ paddingHorizontal: 14, paddingVertical: 12, marginTop: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Ionicons name="sparkles-outline" size={iconSize.lg} color={theme.color.text} />
          <Text variant="title" style={{ fontSize: 16 }}>
            {t.company.agentsTitle}
          </Text>
        </View>
        <ListRow
          leading={lead('hardware-chip-outline')}
          title={t.company.agentsAllow}
          subtitle={t.company.agentsAllowHint}
          subtitleLines={3}
          trailing={
            <Toggle
              value={enabled}
              onValueChange={(next) => save.mutate({ enabled: next, approval })}
              accessibilityLabel={t.company.agentsAllow}
            />
          }
          divider={enabled}
        />
        {enabled ? (
          <>
            <ListRow
              leading={lead('shield-checkmark-outline')}
              title={t.company.agentsApproval}
              subtitle={t.company.agentsApprovalHint}
              subtitleLines={3}
              trailing={
                <Toggle
                  value={approval}
                  onValueChange={(next) => save.mutate({ enabled, approval: next })}
                  accessibilityLabel={t.company.agentsApproval}
                />
              }
              divider
            />
            <Text variant="caption" tone="muted" style={{ marginTop: 8 }}>
              {t.company.agentsConnected}
            </Text>
            {links.length === 0 ? (
              <Text variant="caption" tone="muted" style={{ marginVertical: 8 }}>
                {t.company.agentsEmpty}
              </Text>
            ) : (
              links.map((link) => (
                <ListRow
                  key={link.id}
                  title={`${link.name} · ${link.clientId}`}
                  subtitle={
                    link.lastUsedAt
                      ? fill(t.company.agentsLastUsed, {
                          when: new Date(link.lastUsedAt).toLocaleDateString(),
                        })
                      : t.company.agentsNeverUsed
                  }
                  trailing={
                    <Button
                      label="⋮"
                      variant="secondary"
                      accessibilityLabel={t.company.agentsActions}
                      onPress={() => setMenuLink(link)}
                    />
                  }
                  divider
                />
              ))
            )}
            <ListRow
              leading={lead('time-outline')}
              title={t.company.agentsActivity}
              onPress={() => setShowActivity((v) => !v)}
              trailing={
                <Ionicons
                  name={showActivity ? 'chevron-up' : 'chevron-down'}
                  size={iconSize.md}
                  color={theme.color.textMuted}
                />
              }
            />
            {showActivity
              ? (activity.data ?? []).length === 0
                ? !activity.isLoading && (
                    <Text variant="caption" tone="muted">
                      {t.company.agentsActivityEmpty}
                    </Text>
                  )
                : (activity.data ?? []).map((w) => (
                    <ListRow
                      key={w.id}
                      title={`${w.person} · ${w.action}`}
                      subtitle={new Date(w.created_at).toLocaleString()}
                    />
                  ))
              : null}
          </>
        ) : null}
      </StandardCard>
      <OverflowMenu
        visible={menuLink !== null}
        onClose={() => setMenuLink(null)}
        items={
          menuLink
            ? [
                {
                  icon: 'close-circle-outline',
                  label: t.company.agentsRevoke,
                  tone: 'danger',
                  onPress: () => revoke.mutate(menuLink.id),
                },
              ]
            : []
        }
      />
    </>
  );
}
