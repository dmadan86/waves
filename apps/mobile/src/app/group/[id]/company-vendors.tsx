import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Screen, Text, useTheme } from '@waves/ui';

import { OverflowMenu } from '@/components/OverflowMenu';
import { VendorsTab } from '@/components/company/vendors/VendorsTab';
import { ScenicBody, ScenicHeader, useGlass } from '@/components/standard';
import { useCompanySuspended } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useStrings } from '@/i18n';
import { companyOverviewRoute } from '@/lib/companyTab';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

function RoundButton({
  icon,
  label,
  onPress,
  primary = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const theme = useTheme();
  const glass = useGlass();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? theme.color.brand : glass,
      }}
    >
      <Ionicons
        name={icon}
        size={primary ? 24 : 20}
        color={primary ? '#FFFFFF' : theme.color.text}
      />
    </Pressable>
  );
}

/** The vendors dashboard (linked from the company bar and the More screen). */
export default function CompanyVendorsScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const glass = useGlass();
  const { t } = useStrings();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(false);
  const [searching, setSearching] = useState(false);
  const clearance = useBottomClearance();
  const view = useCompanyVendors(id);
  const suspended = useCompanySuspended(id);
  const canManage = view.canManage && !suspended;
  return (
    <Screen edges={[]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: clearance + theme.spacing.xl }}
      >
        <ScenicHeader
          title={t.companyVendors.title}
          onBack={() => router.replace(companyOverviewRoute(id, 'back') as never)}
          identity={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: theme.radius.lg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.surface,
                }}
              >
                <Ionicons name="storefront-outline" size={26} color={theme.color.brand} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  variant="heading"
                  numberOfLines={1}
                  style={{ fontSize: 22, fontWeight: '800' }}
                >
                  {t.companyVendors.title}
                </Text>
                <Text variant="micro" numberOfLines={1}>
                  {t.companyVendors.subtitle}
                </Text>
              </View>
            </View>
          }
          action={
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <RoundButton
                icon="search"
                label={t.companyVendors.search}
                onPress={() => {
                  if (searching) setQuery('');
                  setSearching(!searching);
                }}
              />
              {canManage ? (
                <>
                  <RoundButton
                    icon="ellipsis-vertical"
                    label={t.companyVendors.more}
                    onPress={() => setMenu(true)}
                  />
                  <RoundButton
                    icon="add"
                    label={t.companyVendors.addVendor.replace(/^\+\s*/, '')}
                    primary
                    onPress={() => router.push(`/group/${id}/company-vendor-add`)}
                  />
                </>
              ) : null}
            </View>
          }
          wide
        >
          {searching ? (
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
