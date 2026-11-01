import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, TextInput, View } from 'react-native';

import { Screen, useTheme } from '@waves/ui';

import type { OverflowMenuItem } from '@/components/OverflowMenu';
import { DashBody, DashHeader, IconButton } from '@/components/company/dashboard/parts';
import { VendorsTab } from '@/components/company/vendors/VendorsTab';
import { useGlass } from '@/components/standard';
import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';

/** The vendors dashboard (linked from the company bar and the More screen). */
export default function CompanyVendorsScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const glass = useGlass();
  const { t } = useStrings();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
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
          actions={
            <>
              <IconButton
                round
                icon="search"
                label={t.companyVendors.search}
                onPress={() => {
                  if (searching) setQuery('');
                  setSearching(!searching);
                }}
              />
            </>
          }
        />
        <DashBody>
          {searching ? (
            <View
              style={{
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
                autoFocus
                accessibilityLabel={t.companyVendors.search}
                placeholder={t.companyVendors.search}
                placeholderTextColor={theme.color.textMuted}
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
                style={{ flex: 1, color: theme.color.text, fontSize: 14, padding: 0 }}
              />
            </View>
          ) : null}
          <VendorsTab groupId={id} query={query} />
        </DashBody>
      </ScrollView>
    </Screen>
  );
}
