/**
 * The dashboard's balance card: where you stand across every group, in one
 * figure, on a frosted panel over the hero's indigo wash — "Total you are owed
 * ₹1,13,689.50" with a wallet drawn beside it.
 *
 * One figure, not a swipe deck: the month card below the hero now carries the
 * gross sides and the month's spend side by side, so the card only has to say
 * the verdict. The label carries the direction ("you are owed" / "you owe") and
 * the figure is shown as a magnitude, the way a bank app shows a balance.
 *
 * All in the primary currency — there is no total across currencies (ADR-004).
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

/** What stands in for a figure while the eye is shut — shared with the rows. */
export const BALANCE_MASK = '••••••';

/** The frosted panel every hero block sits on: white at low alpha over the wash. */
export const FROSTED = {
  backgroundColor: 'rgba(255, 255, 255, 0.10)',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.16)',
} as const;

export function HomeBalanceCard({
  net,
  currency,
  locale,
  hidden,
  onToggleHide,
  settling,
  loading,
}: {
  net: bigint;
  currency: string;
  locale: string;
  hidden: boolean;
  onToggleHide: () => void;
  /** The figure is the local one and this session's first sync has not landed. */
  settling: boolean;
  /** Nothing to show yet: bars stand in for the label and the figure. */
  loading: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const label =
    net === 0n ? t.homeDash.totalSettled : net > 0n ? t.homeDash.totalOwed : t.homeDash.totalOwe;

  return (
    <View
      style={{
        ...FROSTED,
        borderRadius: theme.radius.xl,
        paddingVertical: theme.spacing.lg,
        paddingStart: theme.spacing.lg,
        paddingEnd: theme.spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        overflow: 'hidden',
      }}
    >
      <View style={{ flex: 1, gap: theme.spacing.xs }}>
        {loading ? (
          <View style={{ gap: theme.spacing.sm }}>
            {/* Hand-drawn washes: the themed Skeleton is for light surfaces and
                vanishes on the indigo. */}
            <View style={{ ...WASH, width: 140, height: 14 }} />
            <View style={{ ...WASH, width: 190, height: 30 }} />
          </View>
        ) : (
          <>
            <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <Text
                variant="body"
                tone="onBrand"
                numberOfLines={1}
                style={{ flexShrink: 1, opacity: 0.85 }}
              >
                {label}
              </Text>
              {/* The eye: hide the money on a shared screen. It shuts every
                  figure on the dashboard, not just this one. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={hidden ? t.dashHero.showBalance : t.dashHero.hideBalance}
                onPress={onToggleHide}
                hitSlop={10}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 0.85 })}
              >
                <Ionicons
                  name={hidden ? 'eye-off-outline' : 'eye-outline'}
                  size={iconSize.md}
                  color={theme.color.onBrand}
                />
              </Pressable>
              {settling ? <ActivityIndicator size="small" color={theme.color.onBrand} /> : null}
            </Row>
            {hidden ? (
              <Text tone="onBrand" style={AMOUNT_STYLE} numberOfLines={1}>
                {BALANCE_MASK}
              </Text>
            ) : (
              <MoneyText
                amount={net < 0n ? -net : net}
                currency={currency as never}
                locale={locale}
                tone="onBrand"
                style={AMOUNT_STYLE}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              />
            )}
          </>
        )}
      </View>
      <WalletArt currency={currency} locale={locale} />
    </View>
  );
}

const WASH = { borderRadius: 8, backgroundColor: 'rgba(255, 255, 255, 0.28)' } as const;

const AMOUNT_STYLE = { fontSize: 32, lineHeight: 40, fontWeight: '800' } as const;

/** The symbol a currency is written with in this locale — "₹", "$", "€". */
function currencySymbol(currency: string, locale: string): string {
  try {
    return (
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
      })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency
    );
  } catch {
    return currency;
  }
}

/**
 * A wallet with two coins tumbling out of it, drawn from plain views — no
 * image asset to ship, and it takes the currency's own symbol on the coins.
 * Decoration only, so it is hidden from screen readers.
 */
function WalletArt({ currency, locale }: { currency: string; locale: string }) {
  const symbol = currencySymbol(currency, locale);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: 104, height: 88 }}
    >
      <View
        style={{
          position: 'absolute',
          end: 0,
          top: -4,
          width: 92,
          height: 92,
          borderRadius: 46,
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          start: 6,
          top: 24,
          width: 72,
          height: 56,
          borderRadius: 16,
          backgroundColor: '#8F73FF',
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.35)',
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: '-8deg' }],
          shadowColor: '#1B0F4D',
          shadowOpacity: 0.35,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
      >
        <Ionicons name="wallet" size={32} color="#FFFFFF" />
      </View>
      <Coin symbol={symbol} size={36} style={{ end: 4, top: 2 }} />
      <Coin symbol={symbol} size={26} style={{ end: 0, bottom: 2 }} />
    </View>
  );
}

function Coin({
  symbol,
  size,
  style,
}: {
  symbol: string;
  size: number;
  style: { end?: number; top?: number; bottom?: number };
}) {
  return (
    <View
      style={{
        position: 'absolute',
        ...style,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#F6B82B',
        borderWidth: 2,
        borderColor: '#FFD978',
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 4,
        shadowColor: '#7A4A00',
        shadowOpacity: 0.3,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      <Text style={{ fontSize: size * 0.45, fontWeight: '800', color: '#8A5300' }}>{symbol}</Text>
    </View>
  );
}
