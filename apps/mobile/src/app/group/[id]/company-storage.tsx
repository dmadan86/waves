/** Company storage: how much of the company's photo space is used. Same look as the personal Storage screen. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import {
  Button,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Skeleton,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useCompanyStorage } from '@/data/companyStorage';
import { useStrings } from '@/i18n';
import { formatBytes } from '@/lib/bytes';
import { router } from '@/lib/navigation';

export default function CompanyStorageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const usage = useCompanyStorage(groupId);
  const data = usage.data;
  const fraction = data && data.quotaBytes > 0 ? data.usedBytes / data.quotaBytes : 0;
  const percent = Math.min(100, Math.round(fraction * 100));
  const full = !!data && data.quotaBytes > 0 && data.usedBytes >= data.quotaBytes;
  const fill = full ? theme.color.negative : theme.color.brand;

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.xs }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{t.companyStorage.title}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          paddingTop: theme.spacing.xs,
          gap: theme.spacing.sm,
        }}
        showsVerticalScrollIndicator={false}
      >
        {usage.isError && !data ? (
          <Card style={{ gap: theme.spacing.sm }}>
            <Text variant="body" tone="muted">
              {t.companyStorage.loading}
            </Text>
            <Button label={t.retry} fullWidth onPress={() => usage.refetch()} />
          </Card>
        ) : (
          <Card style={{ gap: theme.spacing.sm }}>
            {data ? (
              <>
                <Row style={{ alignItems: 'baseline', gap: theme.spacing.sm }}>
                  <Text style={{ flex: 1, fontSize: 18, fontWeight: '800' }} numberOfLines={1}>
                    {t.companyStorage.usedOfQuota
                      .replace('{used}', formatBytes(data.usedBytes, locale))
                      .replace('{quota}', formatBytes(data.quotaBytes, locale))}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: full ? theme.color.negative : theme.color.textMuted,
                    }}
                  >
                    {t.companyStorage.percentUsed.replace('{percent}', String(percent))}
                  </Text>
                </Row>
                <View
                  style={{
                    flexDirection: 'row',
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: theme.color.surfaceMuted,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.max(percent, data.usedBytes > 0 ? 4 : 0)}%`,
                      backgroundColor: fill,
                      borderRadius: 3,
                    }}
                  />
                </View>
                <Text
                  style={{
                    fontSize: 12,
                    color: full ? theme.color.negative : theme.color.textMuted,
                  }}
                >
                  {full ? t.companyStorage.full : t.companyStorage.note}
                </Text>
              </>
            ) : (
              <Skeleton width="100%" height={40} />
            )}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
