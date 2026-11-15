/** Budgets & sites: manager pools, budget requests and work sites. Owners only. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Text, directionalIcon, iconSize, useTheme } from '@waves/ui';

import { OwnerCashList } from '@/components/company/CompanyCash';
import { CompanySites, useAddSiteSheet } from '@/components/company/CompanySites';
import { BudgetArt } from '@/components/company/dashboard/art';
import { BLUE, BLUE_SOFT, GREEN, GREEN_SOFT, useMoney } from '@/components/company/dashboard/parts';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { ListRow, StandardCard } from '@/components/standard';
import { useCompanyEntries, useCompanyProjects } from '@/data/companyEntries';
import { displayName } from '@/data/types';
import { useStrings } from '@/i18n';

export function CompanyBudgets({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const fmt = useMoney(view.currency);
  const addSite = useAddSiteSheet(groupId);
  const sites = useCompanyProjects(groupId).filter((p) => !p.archived_at);
  const live = view.members.filter((m) => !m.left_at);
  const managers = live.filter((m) => m.role === 'manager');
  const requests = view.entries
    .filter((e) => e.kind === 'pool_request' && !e.deleted)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  const noBudgets = managers.length === 0 && sites.length === 0 && requests.length === 0;
  return (
    <SectionShell groupId={groupId} view={view} ownerOnly>
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.company.addSite}
          onPress={addSite.open}
        >
          <StandardCard
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Ionicons name="location" size={iconSize.lg} color={theme.color.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="body" style={{ fontWeight: '700' }}>
                {t.company.addSite}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={2}>
                {t.company.addSiteBody}
              </Text>
            </View>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.textFaint}
            />
          </StandardCard>
        </Pressable>
        {noBudgets ? (
          <View style={{ alignItems: 'center', gap: 8, paddingTop: 8 }}>
            <BudgetArt />
            <Text variant="heading" align="center">
              {t.company.budgetsNone}
            </Text>
            <Text variant="caption" tone="muted" align="center">
              {t.company.budgetsNoneBody}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              {(
                [
                  ['people-outline', theme.color.brandSoft, theme.color.brand, 'setBudget'],
                  ['git-network-outline', BLUE_SOFT, BLUE, 'assignManager'],
                  ['bar-chart', GREEN_SOFT, GREEN, 'trackSpending'],
                ] as const
              ).map(([icon, bg, fg, key]) => (
                <View key={key} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                  <View
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 23,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: bg,
                    }}
                  >
                    <Ionicons name={icon} size={iconSize.lg} color={fg} />
                  </View>
                  <Text variant="caption" align="center" style={{ fontWeight: '700' }}>
                    {t.company[key]}
                  </Text>
                  <Text variant="caption" tone="muted" align="center" style={{ fontSize: 11.5 }}>
                    {t.company[`${key}Body` as const]}
                  </Text>
                </View>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.company.addSite}
              onPress={addSite.open}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                height: 44,
                paddingHorizontal: 28,
                marginTop: 8,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.buttonPrimary,
              }}
            >
              <Ionicons
                name="add-circle-outline"
                size={iconSize.md}
                color={theme.color.onButtonPrimary}
              />
              <Text style={{ fontWeight: '600', color: theme.color.onButtonPrimary }}>
                {t.company.addSite}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <OwnerCashList groupId={groupId} view={view} />
            {requests.length > 0 ? (
              <>
                <Text variant="title">{t.company.budgetRequests}</Text>
                <StandardCard>
                  {requests.map((r, i) => {
                    const m = live.find((x) => x.id === r.memberId);
                    return (
                      <ListRow
                        key={r.id}
                        title={m ? displayName(m, null, null, t.misc.someone) : t.misc.someone}
                        subtitle={[m?.employee_id, r.note].filter(Boolean).join(' · ') || undefined}
                        amount={fmt(r.amount)}
                        divider={i < requests.length - 1}
                      />
                    );
                  })}
                </StandardCard>
              </>
            ) : null}
            <CompanySites groupId={groupId} view={view} />
          </>
        )}
      </>
    </SectionShell>
  );
}
