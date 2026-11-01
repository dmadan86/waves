/** Company storage: how much of the company's photo space is used. Same look as the personal Storage screen. */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import type { PurchasesStoreProduct } from 'react-native-purchases';
import { ScrollView, View } from 'react-native';

import {
  Button,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  Skeleton,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyStorage } from '@/data/companyStorage';
import { useStrings } from '@/i18n';
import { formatBytes } from '@/lib/bytes';
import { backend } from '@/lib/backend';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';
import {
  buyCompanyStoragePack,
  hasActiveCompanyStoragePack,
  loadCompanyStoragePacks,
} from '@/lib/purchases';

export default function CompanyStorageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const usage = useCompanyStorage(groupId);
  const view = useCompanyEntries(groupId);
  const queryClient = useQueryClient();
  const { notify } = useDialog();
  // Only the owner buys, and only once the store actually returns the products.
  const [packs, setPacks] = useState<PurchasesStoreProduct[]>([]);
  const [buying, setBuying] = useState(false);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    let live = true;
    if (view.isOwner) void loadCompanyStoragePacks().then((found) => live && setPacks(found));
    return () => {
      live = false;
    };
  }, [view.isOwner]);
  const buy = async (pack: PurchasesStoreProduct) => {
    if (buying) return;
    // This store account already pays a pack for another company: a store product change would
    // replace that pack instead of adding one.
    if (hasActiveCompanyStoragePack()) {
      const { data: holder } = await backend.rpc('waves_my_pack_company');
      if (holder && holder !== groupId) {
        setSheet(false);
        await notify({ title: t.companyStorage.packElsewhere });
        return;
      }
    }
    setBuying(true);
    try {
      const outcome = await buyCompanyStoragePack(pack, groupId);
      if (outcome === 'cancelled') return;
      setSheet(false);
      await notify({
        title: outcome === 'pending' ? t.companyStorage.pending : t.companyStorage.bought,
      });
      // The store tells the server first; look again shortly.
      setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: ['company-storage', groupId] }),
        5000,
      );
    } catch {
      await notify({ title: t.companyStorage.buyFailed, tone: 'danger' });
    } finally {
      setBuying(false);
    }
  };
  const data = usage.data;
  const fraction = data ? (data.quotaBytes > 0 ? data.usedBytes / data.quotaBytes : 1) : 0;
  const percent = Math.min(100, Math.round(fraction * 100));
  const full = !!data && data.usedBytes >= data.quotaBytes;
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
        {packs.length > 0 ? (
          <Button label={t.companyStorage.addMore} fullWidth onPress={() => setSheet(true)} />
        ) : null}
      </ScrollView>
      {packs.length > 0 ? (
        <Sheet visible={sheet} onClose={() => setSheet(false)} closeLabel={t.common.close}>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="title">{t.companyStorage.addMore}</Text>
            {packs.map((pack) => (
              <Button
                key={pack.identifier}
                label={t.companyStorage.packLine
                  .replace('{size}', pack.identifier.includes('5gb') ? '5 GB' : '1 GB')
                  .replace('{price}', pack.priceString)}
                fullWidth
                disabled={buying}
                onPress={() => void buy(pack)}
              />
            ))}
            <Text variant="caption" tone="muted">
              {t.companyStorage.packNote}
            </Text>
          </View>
        </Sheet>
      ) : null}
    </Screen>
  );
}
