import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { PurchasesStoreProduct } from 'react-native-purchases';
import { Button, iconSize, Row, Sheet, Text, useTheme } from '@waves/ui';
import {
  ListRow,
  RowTile,
  ScenicBody,
  ScenicHeader,
  SectionHeader,
  StandardCard,
} from '@/components/standard';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { readCredits } from '@/lib/adCredits';
import { creditButtonKey } from '@/lib/adCreditsPure';
import { useBottomClearance } from '@/lib/clearance';
import { buyCreditPack, loadCreditPacks, purchasesAvailable } from '@/lib/purchases';
import { watchCreditAd } from '@/lib/watchCreditAd';
import { useEntitlement } from '@/lib/useEntitlement';
import { router } from '@/lib/navigation';
import { useDialog } from '@/lib/dialog';

const USES = [
  { kind: 'voice', icon: 'mic-outline', sub: 'voiceSub', tint: 'lilac' },
  { kind: 'scan', icon: 'camera-outline', sub: 'scanSub', tint: 'sky' },
  { kind: 'export', icon: 'document-text-outline', sub: 'exportSub', tint: 'mint' },
  { kind: 'group', icon: 'people-outline', sub: 'groupSub', tint: 'peach' },
] as const;

export default function CreditsScreen() {
  const theme = useTheme();
  const c = theme.color;
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const viewerId = useViewerId();
  const { isPaid } = useEntitlement();
  const wallet = useQuery({
    queryKey: ['credits', viewerId],
    queryFn: readCredits,
    enabled: !!viewerId,
    refetchInterval: 30000,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [help, setHelp] = useState(false);
  const [packs, setPacks] = useState<PurchasesStoreProduct[]>([]);
  const s = wallet.data;
  const free = !isPaid;
  const { notify } = useDialog();
  // One pop-up that says why, instead of a disabled tile with a raw status line.
  const explain = (key: 'tomorrow' | 'later' | 'full' | 'unavailable') =>
    notify({
      title: key === 'unavailable' ? t.adGates.blockedTitle : t.credits[key],
      body:
        key === 'unavailable'
          ? t.adGates.blockedBody
          : s?.nextAt
            ? fill(t.credits.nextAt, { time: new Date(s.nextAt).toLocaleString() })
            : t.credits.earn,
    });

  useEffect(() => {
    if (!free || !purchasesAvailable()) return;
    let live = true;
    void loadCreditPacks().then((found) => live && setPacks(found));
    return () => {
      live = false;
    };
  }, [free]);

  const watch = async () => {
    if (busy || !viewerId || isPaid) return;
    if (!s?.canWatch) {
      const key = s ? creditButtonKey(s) : 'unavailable';
      return void explain(key === 'watch' ? 'unavailable' : key);
    }
    setBusy(true);
    try {
      const result = await watchCreditAd(viewerId, 'voluntary', 'credit_voluntary');
      if (result === 'credited')
        setMessage(fill(t.credits.balance, { n: (await readCredits())?.credits ?? s.credits }));
      else if (result === 'pending') setMessage(t.rewardedAds.pending);
      else void explain('unavailable');
      await wallet.refetch();
    } finally {
      setBusy(false);
    }
  };

  const buy = async (pack: PurchasesStoreProduct) => {
    if (busy) return;
    setBusy(true);
    try {
      if ((await buyCreditPack(pack)) === 'pending') setMessage(t.rewardedAds.pending);
      await wallet.refetch();
    } catch {
      setMessage(t.rewardedAds.error);
    } finally {
      setBusy(false);
    }
  };

  const tile = {
    flex: 1,
    minHeight: 64,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.md,
    alignItems: 'center',
    gap: theme.spacing.sm,
  } as const;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader
          title={t.credits.title}
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.credits.help}
              onPress={() => setHelp(true)}
              hitSlop={8}
            >
              <Ionicons name="help-circle-outline" size={iconSize.lg} color={c.text} />
            </Pressable>
          }
        />
        <ScenicBody>
          {free ? (
            <>
              <StandardCard style={{ gap: theme.spacing.xs }}>
                <Text variant="caption" tone="muted">
                  {t.credits.yourCredits}
                </Text>
                <Text style={{ fontSize: 34, lineHeight: 40, fontWeight: '800' }} tabular>
                  {s?.credits ?? '–'}
                </Text>
                <Text variant="caption" tone="muted">
                  {t.credits.yourCreditsHint}
                </Text>
              </StandardCard>

              <Row style={{ gap: theme.spacing.md }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => void watch()}
                  style={[tile, { flexDirection: 'row', backgroundColor: c.brand }]}
                >
                  <Ionicons name="play-circle" size={iconSize.xl} color={c.onBrand} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onBrand, fontWeight: '700' }} numberOfLines={1}>
                      {fill(t.credits.watch, { n: s?.perAd ?? 6 })}
                    </Text>
                    <Text variant="micro" style={{ color: c.onBrand }} numberOfLines={2}>
                      {fill(t.credits.watchSub, { n: s?.perAd ?? 6 })}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/settings/upgrade')}
                  style={[tile, { flexDirection: 'row', backgroundColor: c.brandSoft }]}
                >
                  <Ionicons name="ribbon-outline" size={iconSize.lg} color={c.brand} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700' }} numberOfLines={1}>
                      {t.credits.getPro}
                    </Text>
                    <Text variant="micro" tone="muted" numberOfLines={2}>
                      {t.credits.proSub}
                    </Text>
                  </View>
                </Pressable>
              </Row>
              {message ? <Text variant="caption">{message}</Text> : null}

              {s ? (
                <StandardCard>
                  <SectionHeader
                    title={t.credits.howUsed}
                    action={{ label: t.credits.learnMore, onPress: () => setHelp(true) }}
                  />
                  {USES.map(({ kind, icon, sub, tint }, i) => (
                    <ListRow
                      key={kind}
                      divider={i < USES.length - 1}
                      leading={
                        <RowTile tint={theme.tint[tint].bg}>
                          <Ionicons name={icon} size={iconSize.md} color={theme.tint[tint].ink} />
                        </RowTile>
                      }
                      title={t.credits[kind]}
                      subtitle={t.credits[sub]}
                      amount={fill(t.credits.price, { n: s.costs[kind] })}
                    />
                  ))}
                </StandardCard>
              ) : null}

              {packs.length > 0 ? (
                <View style={{ gap: theme.spacing.md }}>
                  <SectionHeader title={t.credits.buyTitle} />
                  <Row style={{ gap: theme.spacing.sm }}>
                    {packs.map((pack) => {
                      const n = Number(pack.identifier.split(':')[0]?.split('_')[1]);
                      const popular = n === 200;
                      return (
                        <StandardCard
                          key={pack.identifier}
                          style={{
                            flex: 1,
                            alignItems: 'center',
                            gap: theme.spacing.xs,
                            padding: theme.spacing.md,
                          }}
                        >
                          {popular ? (
                            <Text variant="micro" style={{ color: c.brand, fontWeight: '700' }}>
                              {t.credits.popular}
                            </Text>
                          ) : null}
                          <Text style={{ fontWeight: '700' }}>{fill(t.credits.price, { n })}</Text>
                          <Text tabular>{pack.priceString}</Text>
                          <Button
                            label={t.credits.buy}
                            variant={popular ? 'primary' : 'secondary'}
                            disabled={busy}
                            onPress={() => void buy(pack)}
                          />
                        </StandardCard>
                      );
                    })}
                  </Row>
                </View>
              ) : null}

              <Row
                style={{
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  padding: theme.spacing.md,
                  borderRadius: theme.radius.xl,
                  backgroundColor: c.brandSoft,
                }}
              >
                <Ionicons name="infinite" size={iconSize.lg} color={c.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700' }}>{t.credits.neverExpire}</Text>
                  <Text variant="caption" tone="muted">
                    {t.credits.neverExpireSub}
                  </Text>
                </View>
              </Row>
            </>
          ) : (
            <Text variant="caption" tone="muted">
              {t.credits.paidNote}
            </Text>
          )}
        </ScenicBody>
      </ScrollView>
      <Sheet visible={help} onClose={() => setHelp(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">{t.credits.title}</Text>
          <Text>{t.credits.earn}</Text>
        </View>
      </Sheet>
    </View>
  );
}
