import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { Screen } from '@waves/ui';

import { DetailsScreenBody } from '@/components/company/details/CompanyDetailsView';
import { ScenicBody, ScenicHeader } from '@/components/standard';
import { useCompanyVendors } from '@/data/companyVendors';
import { useStrings } from '@/i18n';

export default function CompanyDetailsScreen() {
  const { id, vendorId, mine } = useLocalSearchParams<{
    id: string;
    vendorId?: string;
    mine?: string;
  }>();
  const { t } = useStrings();
  const vendors = useCompanyVendors(id ?? '');
  const isMine =
    mine === '1' &&
    !!vendorId &&
    vendors.vendors.some((v) => v.id === vendorId && v.memberId === vendors.myMemberId);
  const title = vendorId
    ? isMine
      ? t.companyDetails.myDetails
      : t.companyDetails.vendorDetails
    : t.companyDetails.title;
  return (
    <Screen edges={[]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScenicHeader title={title} />
        <ScenicBody>
          <DetailsScreenBody groupId={id ?? ''} vendorId={vendorId} />
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}
