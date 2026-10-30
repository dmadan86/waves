import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, useTheme } from '@waves/ui';
import { ListRow } from '@/components/standard';
import { useCompanyDocs, useUnpaidBills } from '@/data/companyDocuments';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function CompanyBillsRow({ groupId }: { groupId: string }) {
  const { canUse } = useCompanyDocs(groupId);
  const { count } = useUnpaidBills(groupId);
  const { t } = useStrings();
  const theme = useTheme();
  if (!canUse) return null;
  return (
    <ListRow
      leading={
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name="document-text-outline" size={22} color={theme.color.brand} />
        </View>
      }
      title={t.companyDocs.title}
      titleAccessory={
        count ? (
          <Text
            variant="micro"
            style={{
              backgroundColor: theme.color.brandSoft,
              color: theme.color.brand,
              borderRadius: theme.radius.pill,
              paddingHorizontal: theme.spacing.sm,
            }}
          >
            {count}
          </Text>
        ) : undefined
      }
      onPress={() => router.push(`/group/${groupId}/company-bills`)}
    />
  );
}
