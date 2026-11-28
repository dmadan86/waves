/**
 * Your companies: one card per company the viewer belongs to, with who is in it.
 * The Company tab opens here when there is more than one; a card switches to that
 * company's home, "Create new" starts a new company.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { Image, Pressable, ScrollView, View } from 'react-native';

import { Text, Screen, iconSize, useTheme } from '@waves/ui';

import { BUILDING_ART } from '@/components/company/dashboard/art';
import { LIST_TILE, ListCard, ListItem, ScenicBody, ScenicHeader } from '@/components/standard';
import { useGroup, useGroups } from '@/data/hooks';
import { useGroupPhotoUrl } from '@/components/GroupPhoto';
import { fill, plural, useStrings } from '@/i18n';
import { COMPANIES_ENABLED } from '@/lib/companiesEnabled';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { useToast } from '@/lib/toast';
import { useViewerCompanyIds } from '@/lib/useCompanyTab';
import { useRememberSpace } from '@/lib/useSpaces';
import type { GroupRow } from '@/data/types';

function CompanyRow({
  group,
  current,
  divider,
}: {
  group: GroupRow;
  current: boolean;
  divider: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { members } = useGroup(group.id);
  const logo = useGroupPhotoUrl(group.photo_path);
  const remember = useRememberSpace();
  const toast = useToast();
  const live = (members.data ?? []).filter((m) => !m.left_at);
  const count = (role: string) => live.filter((m) => m.role === role).length;
  const name = group.name?.trim() || t.company.tab;
  return (
    <ListItem
      divider={divider}
      title={name}
      leading={
        <Image
          source={logo ? { uri: logo } : BUILDING_ART}
          resizeMode={logo ? 'contain' : 'cover'}
          style={{ width: LIST_TILE, height: LIST_TILE, borderRadius: theme.radius.md }}
        />
      }
      subtitle={[
        plural(locale, count('member'), t.company.employeeCount),
        plural(locale, count('manager'), t.company.managerCount),
        plural(locale, count('admin'), t.company.ownerCount),
      ].join(' · ')}
      caption={current ? t.company.currentCompany : undefined}
      captionColor={theme.color.brand}
      chevron
      onPress={() => {
        remember(group.id);
        if (!current) toast.show(fill(t.spaces.switchedTo, { name }));
        router.replace(`/group/${group.id}`);
      }}
    />
  );
}

function CompaniesScreenBody() {
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
                borderRadius: theme.radius.sm,
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
          {companies.length === 0 ? (
            <Text variant="body" tone="muted" align="center">
              {t.company.companiesEmpty}
            </Text>
          ) : null}
          {companies.length > 0 ? (
            <ListCard>
              {companies.map((group, index) => (
                <CompanyRow
                  key={group.id}
                  group={group}
                  current={group.id === currentId}
                  divider={index > 0}
                />
              ))}
            </ListCard>
          ) : null}
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}

export default function CompaniesScreen() {
  if (!COMPANIES_ENABLED) return <Redirect href="/" />;
  return <CompaniesScreenBody />;
}
