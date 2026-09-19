/**
 * THROWAWAY — the Save-an-expense amount, dressed as the dashboard's hero.
 *
 * Built to be looked at, not to be kept. It exists so the question "should this
 * screen open the way Home and a group do?" can be answered by seeing it rather
 * than by imagining it, and the honest answer may well be no. Nothing else
 * imports it; deleting this file and the two lines that use it puts the screen
 * back exactly as it was.
 *
 * What it borrows, and from where:
 *
 *   - `ScreenHero` — the same shell the dashboard, a group, Review and Bank
 *     messages already open with: a saturated wash running up under the status
 *     bar, a rounded bottom, the identity glyph and name on the top row. Not a
 *     copy of that panel; the panel itself.
 *   - `AmountField`'s `hero` size with `tone="onBrand"` — a pairing the
 *     component already documents as "the amount inside a coloured header bar".
 *     It was written for this and had no caller.
 *
 * What it changes, because a gradient changes it:
 *
 *   The stepper discs and the quick-amount chips are translucent white rather
 *   than surface-on-surface. On a wash there is no "muted surface" to sit on —
 *   a grey pill over indigo reads as a hole, not a control — so they take the
 *   same dim-white treatment `HeroActionCircle` uses, which is what every other
 *   hero's secondary controls already wear.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { currencySymbol, minorUnitScale, type CurrencyCode } from '@waves/core';
import { AmountField, iconSize, Row, Text, useTheme } from '@waves/ui';

import { ScreenHero } from '@/components/ScreenHero';
import { useStrings } from '@/i18n';

/** One whole unit of the currency a press — see `AmountHeader` for why. */
const STEP_MAJOR = 1n;
const QUICK_MAJOR = [5n, 10n, 50n, 100n, 500n, 1000n] as const;

/** White at the two weights a wash allows: a control, and a control's edge. */
const ON_WASH_FILL = 'rgba(255,255,255,0.18)';
const ON_WASH_EDGE = 'rgba(255,255,255,0.32)';

function WashStepper({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'add' | 'remove';
  label: string;
  disabled?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.pill,
        backgroundColor: ON_WASH_FILL,
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.onBrand} />
    </Pressable>
  );
}

export function AmountHeroPanel({
  title,
  currency,
  amount,
  onAmountChange,
  onPressCurrency,
  onClose,
  closeLabel,
}: {
  title: string;
  currency: string;
  amount: bigint;
  onAmountChange: (value: bigint) => void;
  onPressCurrency: () => void;
  onClose: () => void;
  closeLabel: string;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();

  const scale = minorUnitScale(currency as CurrencyCode);
  const bump = (by: bigint): void => {
    const next = amount + by;
    onAmountChange(next < 0n ? 0n : next);
  };

  return (
    <ScreenHero
      icon="receipt-outline"
      title={title}
      actions={[{ icon: 'close', label: closeLabel, onPress: onClose }]}
    >
      <Row style={{ alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm }}>
        <WashStepper
          icon="remove"
          label={t.captures.amountDown}
          disabled={amount <= 0n}
          onPress={() => bump(-(STEP_MAJOR * scale))}
        />
        <Row
          style={{
            flexShrink: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.xs,
          }}
        >
          <AmountField
            currency={currency}
            value={amount}
            onChange={onAmountChange}
            size="hero"
            tone="onBrand"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t.captures.currencyLabel}: ${currency}`}
            onPress={onPressCurrency}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              flexShrink: 0,
              gap: theme.spacing.xs,
              minHeight: 44,
              paddingVertical: theme.spacing.xs,
              paddingHorizontal: theme.spacing.sm,
              borderRadius: theme.radius.pill,
              backgroundColor: ON_WASH_FILL,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text variant="caption" style={{ fontWeight: '700', color: theme.color.onBrand }}>
              {currency}
            </Text>
            <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.onBrand} />
          </Pressable>
        </Row>
        <WashStepper
          icon="add"
          label={t.captures.amountUp}
          onPress={() => bump(STEP_MAJOR * scale)}
        />
      </Row>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xs }}
      >
        {QUICK_MAJOR.map((major) => {
          const label = `+${currencySymbol(currency)}${major.toString()}`;
          return (
            <Pressable
              key={major.toString()}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => bump(major * scale)}
              style={({ pressed }) => ({
                minHeight: 40,
                justifyContent: 'center',
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: ON_WASH_EDGE,
                backgroundColor: ON_WASH_FILL,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text variant="caption" style={{ fontWeight: '600', color: theme.color.onBrand }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {/* A hair of room under the chips: `ScreenHero`'s own bottom padding is
          sized for a balance line, not for a control that can be pressed. */}
      <View style={{ height: theme.spacing.xs }} />
    </ScreenHero>
  );
}
