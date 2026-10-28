/**
 * The viewer's companies, when there is more than one: the Company tab opens
 * here, and each row opens that company's home. One company skips this screen.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';

import { Screen, directionalIcon, iconSize, useTheme } from '@waves/ui';

import { ListRow, ScenicBody, ScenicHeader, StandardCard } from '@/components/standard';
import { useGroups } from '@/data/hooks';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { useViewerCompanyIds } from '@/lib/useCompanyTab';

export default function CompaniesScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const ids = useViewerCompanyIds();
  const groups = useGroups().data ?? [];
  const companies = ids.flatMap((id) => groups.filter((group) => group.id === id));

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader title={t.company.listTitle} />
        <ScenicBody>
          <StandardCard>
            {companies.map((group, index) => (
              <ListRow
                key={group.id}
                divider={index < companies.length - 1}
                title={group.name?.trim() || t.company.tab}
                leading={
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: theme.radius.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: theme.color.brandSoft,
                    }}
                  >
                    <Ionicons
                      name="business-outline"
                      size={iconSize.md}
                      color={theme.color.brand}
                    />
                  </View>
                }
                trailing={
                  <Ionicons
                    name={directionalIcon('chevron-forward')}
                    size={iconSize.md}
                    color={theme.color.textFaint}
                  />
                }
                onPress={() => router.push(`/group/${group.id}`)}
              />
            ))}
          </StandardCard>
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}
