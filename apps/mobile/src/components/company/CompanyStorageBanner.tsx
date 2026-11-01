import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { STORAGE_WARN_AT, useCompanyStorage } from '@/data/companyStorage';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

/** "Storage 80% full — add more" for owners and managers; renders nothing below the threshold. */
export function CompanyStorageBanner({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const usage = useCompanyStorage(groupId);
  const data = usage.data;
  const fraction = data ? (data.quotaBytes > 0 ? data.usedBytes / data.quotaBytes : 1) : 0;
  if (!data || fraction < STORAGE_WARN_AT) return null;
  const percent = Math.min(100, Math.floor(fraction * 100));
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/group/${groupId}/company-storage`)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        marginHorizontal: theme.spacing.md,
        marginBottom: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Ionicons name="cloud-outline" size={18} color={theme.color.brand} />
      <Text variant="caption" style={{ flex: 1 }}>
        {t.companyStorage.banner.replace('{percent}', String(percent))}
      </Text>
    </Pressable>
  );
}
