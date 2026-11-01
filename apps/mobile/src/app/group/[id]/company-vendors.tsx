import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, TextInput, View } from 'react-native';

import { Screen, useTheme } from '@waves/ui';

import { OverflowMenu } from '@/components/OverflowMenu';
import { VendorMore } from '@/components/company/vendors/VendorHistory';
import { VendorsTab } from '@/components/company/vendors/VendorsTab';
import { ScenicBody, ScenicHeader, useGlass } from '@/components/standard';
import { useCompanySuspended } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useStrings } from '@/i18n';
import { companyOverviewRoute } from '@/lib/companyTab';
import { router } from '@/lib/navigation';

/** The vendors dashboard (linked from the company bar and the More screen). */
export default function CompanyVendorsScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const glass = useGlass();
  const { t } = useStrings();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(false);
  const view = useCompanyVendors(id);
  const suspended = useCompanySuspended(id);
  const canManage = view.canManage && !suspended;
  return (
    <Screen edges={[]}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ScenicHeader
          title={t.companyVendors.title}
          onBack={() => router.replace(companyOverviewRoute(id, 'back') as never)}
          action={canManage ? <VendorMore onPress={() => setMenu(true)} /> : undefined}
          wide
        >
          <View
            style={{
              flex: 1,
              height: 38,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.pill,
              backgroundColor: glass,
            }}
          >
            <Ionicons name="search" size={18} color={theme.color.textMuted} />
            <TextInput
              accessibilityLabel={t.companyVendors.search}
              placeholder={t.companyVendors.search}
              placeholderTextColor={theme.color.textMuted}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              style={{ flex: 1, color: theme.color.text, fontSize: 14, padding: 0 }}
            />
          </View>
        </ScenicHeader>
        <ScenicBody>
          <VendorsTab groupId={id} query={query} />
        </ScenicBody>
      </ScrollView>
      <OverflowMenu
        visible={menu}
        onClose={() => setMenu(false)}
        items={[
          {
            icon: 'person-add-outline',
            label: t.companyVendors.addVendor.replace(/^\+\s*/, ''),
            route: `/group/${id}/company-vendor-add`,
          },
          {
            icon: 'business-outline',
            label: t.companyDetails.title,
            route: `/group/${id}/company-details`,
          },
        ]}
      />
    </Screen>
  );
}
