import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { Screen, useTheme } from '@waves/ui';

import type { OverflowMenuItem } from '@/components/OverflowMenu';
import { DashBody, DashHeader } from '@/components/company/dashboard/parts';
import { VendorsTab } from '@/components/company/vendors/VendorsTab';
import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';

/** The vendors dashboard (linked from the company bar and the More screen). */
export default function CompanyVendorsScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { t } = useStrings();
  const clearance = useBottomClearance();
  const view = useCompanyVendors(id);
  const suspended = useCompanySuspended(id);
  const entries = useCompanyEntries(id);
  const canManage = view.canManage && !suspended;
  const menuItems: OverflowMenuItem[] = [
    {
      icon: 'person-add-outline',
      label: t.companyVendors.addVendor.replace(/^\+\s*/, ''),
      route: `/group/${id}/company-vendor-add`,
    },
    {
      icon: 'cloud-upload-outline',
      label: t.companyImport.menuRow,
      route: `/group/${id}/company-import?entity=vendor`,
    },
    {
      icon: 'business-outline',
      label: t.companyDetails.title,
      route: `/group/${id}/company-details`,
    },
  ];
  return (
    <Screen edges={[]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: clearance + theme.spacing.xl }}
      >
        <DashHeader
          tab
          groupId={id}
          view={entries}
          subtitle=""
          showGear={entries.isOwner}
          menuItems={canManage ? menuItems : undefined}
        />
        <DashBody>
          <VendorsTab groupId={id} />
        </DashBody>
      </ScrollView>
    </Screen>
  );
}
