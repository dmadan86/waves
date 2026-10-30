/**
 * Your companies: one card per company the viewer belongs to, with who is in it.
 * The Company tab opens here when there is more than one; a card switches to that
 * company's home, "Create new" starts a new company.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { Text, Screen, iconSize, useTheme } from '@waves/ui';

import { CompanyCard } from '@/components/company/CompanyCard';
import { ScenicBody, ScenicHeader } from '@/components/standard';
import { useGroup, useGroups } from '@/data/hooks';
import { useGroupPhotoUrl } from '@/components/GroupPhoto';
import { plural, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { useViewerCompanyIds } from '@/lib/useCompanyTab';
import type { GroupRow } from '@/data/types';

function Card({ group, current }: { group: GroupRow; current: boolean }) {
  const { t, locale } = useStrings();
  const { members } = useGroup(group.id);
  const logo = useGroupPhotoUrl(group.photo_path);
  const live = (members.data ?? []).filter((m) => !m.left_at);
  const count = (role: string) => live.filter((m) => m.role === role).length;
  return (
    <CompanyCard
      name={group.name?.trim() || t.company.tab}
      logo={logo}
      employees={plural(locale, count('member'), t.company.employeeCount)}
      managers={plural(locale, count('manager'), t.company.managerCount)}
      owners={plural(locale, count('admin'), t.company.ownerCount)}
      current={current}
      currentLabel={t.company.currentCompany}
      onPress={() => router.replace(`/group/${group.id}`)}
    />
  );
}

export default function CompaniesScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const ids = useViewerCompanyIds();
  const groups = useGroups().data ?? [];
  const companies = ids.flatMap((id) => groups.filter((group) => group.id === id));
  // The switch sheet passes the company it was opened from.
  const { current: currentId } = useLocalSearchParams<{ current?: string }>();

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader
          title={t.company.listTitle}
          subtitle={t.company.listSubtitle}
          titleAlign="start"
          wash
          wide
        >
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/new-company')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.brand,
              }}
            >
              <Ionicons name="add" size={iconSize.md} color={theme.color.onBrand} />
              <Text style={{ color: theme.color.onBrand, fontWeight: '600' }}>
                {t.company.createCompanyNew}
              </Text>
            </Pressable>
          </View>
        </ScenicHeader>
        <ScenicBody>
          {companies.map((group) => (
            <Card key={group.id} group={group} current={group.id === currentId} />
          ))}
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}
