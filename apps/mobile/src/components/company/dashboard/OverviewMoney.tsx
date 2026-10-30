/** The owner's money half of the Overview: three tinted cards (owed, paid this month, advances). Waves only records money. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import {
  AMBER,
  IconDisc,
  RED,
  Skeleton,
  TintCard,
} from '@/components/company/dashboard/overviewKit';
import { GREEN } from '@/components/company/dashboard/parts';
import { useOverview } from '@/data/companyOverview';
import { todayIso } from '@/data/personal';
import { plural, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { compactMoney } from '@/lib/overviewMath';

export function MoneyCards({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const o = useOverview(groupId, todayIso());
  if (!o.isOwner) return null;
  if (!o.ready || !o.money)
    return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={116} flex={1} />
        ))}
      </View>
    );
  const m = o.money;
  const fmt = (minor: bigint) => compactMoney(minor, o.currency, locale, t.company.ovCrore);
  const payments = `/group/${groupId}/company-payments`;
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <MoneyCard
        icon="wallet-outline"
        ink={theme.color.brand}
        label={t.company.statOwes}
        value={fmt(m.owes)}
        caption={plural(locale, m.pendingPayments, t.company.ovPaymentsPendingN)}
        captionInk={theme.color.brand}
        onPress={() => router.push(payments)}
      />
      <MoneyCard
        icon="arrow-up"
        ink={GREEN}
        label={t.company.ovPaidMonth}
        value={fmt(m.paidMonth)}
        captionIcon={
          m.paidChange ? (m.paidChange.dir === 'up' ? 'arrow-up' : 'arrow-down') : undefined
        }
        caption={
          m.paidChange ? t.company.ovVsLast.replace('{pct}', String(m.paidChange.pct)) : null
        }
        captionInk={m.paidChange?.dir === 'down' ? RED : GREEN}
        onPress={() => router.push(payments)}
      />
      <MoneyCard
        icon="time-outline"
        ink={AMBER}
        label={t.company.ovAdvances}
        value={fmt(m.advances)}
        caption={plural(locale, m.advanceHolders, t.company.employeeCount)}
        onPress={() => router.push(`/group/${groupId}/company-people`)}
      />
    </View>
  );
}

function MoneyCard({
  icon,
  ink,
  label,
  value,
  caption,
  captionIcon,
  captionInk,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  ink: string;
  label: string;
  value: string;
  /** null hides the line (nothing to compare with). */
  caption: string | null;
  captionIcon?: keyof typeof Ionicons.glyphMap;
  captionInk?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={caption ? `${label}: ${value}, ${caption}` : `${label}: ${value}`}
      onPress={onPress}
      style={{ flex: 1, minWidth: 0 }}
    >
      <TintCard ink={ink} style={{ flex: 1, padding: 10, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <IconDisc ink={ink} size={30}>
            <Ionicons name={icon} size={iconSize.sm} color={ink} />
          </IconDisc>
          <Text
            variant="micro"
            numberOfLines={2}
            style={{ flex: 1, fontSize: 12, lineHeight: 15, color: theme.color.text }}
          >
            {label}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text
            variant="title"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={{ fontSize: 19, fontWeight: '800', flexShrink: 1 }}
          >
            {value}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.sm}
            color={theme.color.textMuted}
          />
        </View>
        {caption ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            {captionIcon ? (
              <Ionicons name={captionIcon} size={iconSize.sm} color={captionInk} />
            ) : null}
            <Text
              variant="micro"
              numberOfLines={2}
              style={{ flexShrink: 1, color: captionInk ?? theme.color.textMuted }}
            >
              {caption}
            </Text>
          </View>
        ) : null}
      </TintCard>
    </Pressable>
  );
}
