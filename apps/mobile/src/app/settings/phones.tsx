/** Your phones: the phones that can read your shared rentals. Remove one you no longer use. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, View } from 'react-native';
import { useState } from 'react';

import { iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { PlainHeader, StandardCard } from '@/components/standard';
import { ensureDeviceId } from '@/e2ee/runtime';
import { fill, useStrings } from '@/i18n';
import { backend } from '@/lib/backend';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';

interface Phone {
  id: string;
  last_seen_at: string;
}

export default function PhonesScreen() {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const clearance = useBottomClearance();
  const { confirm } = useDialog();
  const queryClient = useQueryClient();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const phones = useQuery({
    queryKey: ['e2ee-phones'],
    queryFn: async () => {
      const { data, error } = await backend
        .from('e2ee_devices')
        .select('id, last_seen_at')
        .order('last_seen_at', { ascending: false });
      if (error) throw error;
      return { rows: (data ?? []) as Phone[], mine: await ensureDeviceId().catch(() => '') };
    },
  });
  const remove = async (id: string): Promise<void> => {
    const ok = await confirm({
      title: t.wealth.removePhone,
      body: t.wealth.removePhoneConfirm,
      confirmLabel: t.wealth.removePhone,
      tone: 'danger',
    });
    if (!ok) return;
    setRemoveError(null);
    try {
      const { error } = await backend.rpc('waves_remove_device', { p_device_id: id });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['e2ee-phones'] });
    } catch (caught) {
      setRemoveError(friendlyError(caught, t.wealth.removePhone, 'phones.remove'));
    }
  };
  return (
    <Screen edges={[]}>
      <PlainHeader title={t.wealth.yourPhones} subtitle={t.wealth.yourPhonesSub} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.xl,
          gap: theme.spacing.sm,
        }}
      >
        {phones.error ? (
          <Text tone="muted">{friendlyError(phones.error, t.loadErrorBody, 'phones.load')}</Text>
        ) : null}
        {removeError ? <Text tone="muted">{removeError}</Text> : null}
        {phones.data?.rows.map((p) => {
          const mine = p.id === phones.data.mine;
          return (
            <StandardCard key={p.id}>
              <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                <Ionicons
                  name="phone-portrait-outline"
                  size={iconSize.md}
                  color={theme.color.brand}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="body" style={{ fontWeight: '700' }}>
                    {mine ? t.wealth.thisPhone : t.wealth.yourPhones}
                  </Text>
                  <Text variant="micro" tone="muted">
                    {fill(t.wealth.phoneLastSeen, {
                      when: new Date(p.last_seen_at).toLocaleString(locale),
                    })}
                  </Text>
                </View>
                {mine || !phones.data.mine ? null : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.wealth.removePhone}
                    hitSlop={10}
                    onPress={() => void remove(p.id)}
                  >
                    <Text variant="body" style={{ color: theme.color.negative, fontWeight: '700' }}>
                      {t.wealth.removePhone}
                    </Text>
                  </Pressable>
                )}
              </Row>
            </StandardCard>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
