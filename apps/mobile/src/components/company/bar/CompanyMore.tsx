import Ionicons from '@expo/vector-icons/Ionicons';

import { iconSize, useTheme } from '@waves/ui';

import { CompanyRules } from '@/components/company/CompanyRules';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function CompanyMore({ groupId }: { groupId: string }) {
  const view = useCompanyEntries(groupId);
  const { t } = useStrings();
  const theme = useTheme();
  const lead = (name: keyof typeof Ionicons.glyphMap) => (
    <Ionicons name={name} size={iconSize.lg} color={theme.color.textMuted} />
  );

  // VENDORS ROW: add when a company vendors route exists
  return (
    <SectionShell groupId={groupId} view={view}>
      <StandardCard>
        {view.isOwner ? (
          <ListRow
            leading={lead('wallet-outline')}
            title={t.company.moreBudgets}
            onPress={() => router.push(`/group/${groupId}/company-budgets`)}
            divider
          />
        ) : null}
        <ListRow
          leading={lead('document-text-outline')}
          title={t.company.moreStatements}
          onPress={() => router.push(`/group/${groupId}/export`)}
          divider
        />
        {view.isOwner ? (
          <ListRow
            leading={lead('settings-outline')}
            title={t.company.companySettings}
            onPress={() => router.push(`/group/${groupId}/settings`)}
            divider
          />
        ) : null}
        <ListRow
          leading={lead('swap-horizontal-outline')}
          title={t.company.switchCompany}
          onPress={() => router.push('/companies')}
        />
      </StandardCard>
      {view.isOwner ? (
        <>
          <SectionHeader title={t.company.moreRules} />
          <CompanyRules groupId={groupId} view={view} />
        </>
      ) : null}
    </SectionShell>
  );
}
