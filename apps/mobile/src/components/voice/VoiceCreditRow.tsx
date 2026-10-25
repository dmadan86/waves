import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { directionalIcon, Text, useTheme } from '@waves/ui';
import { VOICE_AGENT_FREE_MONTHLY } from '@waves/core';
import { backend } from '@/lib/backend';
import { fill, useStrings } from '@/i18n';
import { readCredits } from '@/lib/adCredits';
import { useViewerId } from '@/lib/auth';
import { useEntitlement } from '@/lib/useEntitlement';
import { useRewardedAdOffer } from '@/lib/useRewardedAdOffer';

/** The existing server-controlled offer, shown only when allowance and wallet are low. */
export function VoiceCreditRow() {
  const theme = useTheme();
  const { t } = useStrings();
  const { isPaid } = useEntitlement();
  const viewerId = useViewerId();
  const month = new Date().toISOString().slice(0, 7);
  const usage = useQuery({
    queryKey: ['voiceEntryAllowance', viewerId, month],
    enabled: !!viewerId && !isPaid,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await backend
        .from('voice_agent_usage')
        .select('count')
        .eq('profile_id', viewerId!)
        .eq('month', month)
        .maybeSingle();
      if (error) throw error;
      return data?.count ?? 0;
    },
  });
  const wallet = useQuery({
    queryKey: ['credits', viewerId],
    queryFn: readCredits,
    enabled: !!viewerId,
  });
  const offer = useRewardedAdOffer();
  const low = usage.isSuccess && usage.data >= VOICE_AGENT_FREE_MONTHLY - 1;
  const show =
    !isPaid &&
    low &&
    wallet.data &&
    wallet.data.credits <= wallet.data.costs.voice &&
    offer.canOffer('voice');
  const label = fill(t.rewardedAds.voiceTitle, { count: offer.amount('voice') });
  return (
    <>
      {show ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => void offer.offer('voice')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            padding: theme.spacing.sm,
            minHeight: 48,
            borderRadius: theme.radius.xl,
            backgroundColor: theme.color.brandSoft,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="sparkles" size={24} color={theme.color.brand} />
          <Text variant="caption" tone="brand" style={{ flex: 1, fontWeight: '600' }}>
            {label}
          </Text>
          <View>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={20}
              color={theme.color.brand}
            />
          </View>
        </Pressable>
      ) : null}
      {offer.sheet}
    </>
  );
}
