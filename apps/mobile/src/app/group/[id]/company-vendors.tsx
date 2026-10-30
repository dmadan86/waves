import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { Screen } from '@waves/ui';

import { VendorsTab } from '@/components/company/vendors/VendorsTab';
import { ScenicBody, ScenicHeader } from '@/components/standard';
import { useStrings } from '@/i18n';

/** The vendor list as its own screen (linked from the dashboard and the More screen). */
export default function CompanyVendorsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useStrings();
  return (
    <Screen edges={[]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScenicHeader title={t.companyVendors.title} />
        <ScenicBody>
          <VendorsTab groupId={id ?? ''} />
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}
