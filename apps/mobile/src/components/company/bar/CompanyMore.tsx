import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DepartmentSheet } from '@/components/company/DepartmentSheet';

import { iconSize, useTheme } from '@waves/ui';

import { CompanyBillsRow } from '@/components/company/CompanyBillsRow';
import { CompanyRules } from '@/components/company/CompanyRules';
import { AttendanceRow, WorkRow } from '@/components/company/WorkdayEntries';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function CompanyMore({ groupId }: { groupId: string }) {
  const view = useCompanyEntries(groupId);
  const [departmentsOpen, setDepartmentsOpen] = useState(false);
  const vendors = useCompanyVendors(groupId);
  const { t } = useStrings();
  const theme = useTheme();
  const lead = (name: keyof typeof Ionicons.glyphMap) => (
    <Ionicons name={name} size={iconSize.lg} color={theme.color.textMuted} />
  );

  return (
    <SectionShell groupId={groupId} view={view}>
      <StandardCard>
        {vendors.canManage ? (
          <ListRow
            leading={lead('storefront-outline')}
            title={t.companyVendors.title}
            onPress={() => router.push(`/group/${groupId}/company-vendors`)}
            divider
          />
        ) : null}
        {vendors.canManage ? (
          <ListRow
            leading={lead('business-outline')}
            title={t.companyDetails.title}
            onPress={() => router.push(`/group/${groupId}/company-details`)}
            divider
          />
        ) : null}
        <AttendanceRow groupId={groupId} />
        <WorkRow groupId={groupId} />
        <CompanyBillsRow groupId={groupId} />
        {view.isOwner ? (
          <ListRow
            leading={lead('business-outline')}
            title={t.company.departments}
            onPress={() => setDepartmentsOpen(true)}
            divider
          />
        ) : null}
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
        <DepartmentSheet
          groupId={groupId}
          visible={departmentsOpen}
          onClose={() => setDepartmentsOpen(false)}
          manageOnly
        />
      ) : null}
      {view.isOwner ? (
        <>
          <SectionHeader title={t.company.moreRules} />
          <CompanyRules groupId={groupId} view={view} />
        </>
      ) : null}
    </SectionShell>
  );
}
