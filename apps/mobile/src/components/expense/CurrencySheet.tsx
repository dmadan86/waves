/**
 * "Choose currency" for the Save an expense screen: a search over code, name and
 * country, the few currencies this person reaches for as cards along the top,
 * then every offered currency as a row — its flag, code and name, and a radio.
 *
 * The recent cards are remembered on the phone (most recent first, four at
 * most); before anything has been picked they are simply the head of the
 * offered list, with the current currency first.
 */

import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { flagFor } from '@/components/expense/AmountHeader';
import { SheetOverlay } from '@/components/expense/SheetOverlay';
import { useStrings } from '@/i18n';
import { COMMON_CURRENCIES } from '@/lib/currencyChoices';

const RECENT_KEY = 'capture:recentCurrencies';
const RECENT_MAX = 4;

/** English names, for a runtime without `Intl.DisplayNames`. */
const FALLBACK_NAMES: Readonly<Record<string, string>> = {
  INR: 'Indian Rupee',
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  AED: 'UAE Dirham',
  SGD: 'Singapore Dollar',
  AUD: 'Australian Dollar',
  THB: 'Thai Baht',
  VND: 'Vietnamese Dong',
  IDR: 'Indonesian Rupiah',
  MYR: 'Malaysian Ringgit',
  PHP: 'Philippine Peso',
  JPY: 'Japanese Yen',
  KRW: 'South Korean Won',
  LKR: 'Sri Lankan Rupee',
  NPR: 'Nepalese Rupee',
};

/** A name for a currency (and the country it belongs to), in the reader's language. */
function useNames(locale: string): {
  currency: (code: string) => string;
  country: (code: string) => string;
} {
  return useMemo(() => {
    let currencies: Intl.DisplayNames | null = null;
    let regions: Intl.DisplayNames | null = null;
    try {
      currencies = new Intl.DisplayNames([locale], { type: 'currency' });
      regions = new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      // No DisplayNames on this runtime: the English table below stands in.
    }
    const safe = (names: Intl.DisplayNames | null, code: string): string | null => {
      try {
        return names?.of(code) ?? null;
      } catch {
        return null;
      }
    };
    return {
      currency: (code) => safe(currencies, code) ?? FALLBACK_NAMES[code] ?? code,
      country: (code) => safe(regions, code.slice(0, 2)) ?? '',
    };
  }, [locale]);
}

/** Uppercase-first, so "euro" from some locales' data reads as a name. */
const titled = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

export function CurrencySheet({
  value,
  onPick,
  onClose,
}: {
  value: string;
  onPick: (code: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const names = useNames(locale);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(RECENT_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          setRecent(parsed.filter((it): it is string => typeof it === 'string'));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const offered: readonly string[] = COMMON_CURRENCIES;
  const recentCards = useMemo(() => {
    const seed = [value, ...recent, ...offered];
    return [...new Set(seed)].filter((code) => offered.includes(code)).slice(0, RECENT_MAX);
  }, [value, recent, offered]);

  const needle = query.trim().toLowerCase();
  const rows = needle
    ? offered.filter((code) =>
        [code, names.currency(code), names.country(code)].some((text) =>
          text.toLowerCase().includes(needle),
        ),
      )
    : offered;

  const pick = (code: string): void => {
    const next = [code, ...recent.filter((it) => it !== code)].slice(0, RECENT_MAX);
    setRecent(next);
    void AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
    onPick(code);
  };

  const track = theme.scheme === 'dark' ? theme.color.surfaceMuted : '#F1F0FA';

  return (
    <SheetOverlay title={t.captures.currencyPickerTitle} onClose={onClose}>
      <Text variant="body" tone="muted" style={{ marginTop: -theme.spacing.sm }}>
        {t.captureForm.currencySub}
      </Text>

      <Row
        style={{
          alignItems: 'center',
          gap: theme.spacing.md,
          height: 48,
          paddingHorizontal: theme.spacing.lg,
          borderRadius: theme.radius.pill,
          backgroundColor: track,
        }}
      >
        <Ionicons name="search" size={iconSize.md} color={theme.color.text} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t.captureForm.searchCurrency}
          placeholderTextColor={theme.color.textMuted}
          accessibilityLabel={t.captureForm.searchCurrency}
          autoCorrect={false}
          style={{ flex: 1, fontSize: 16, color: theme.color.text, paddingVertical: 0 }}
        />
      </Row>

      {needle ? null : (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="body" tone="muted" style={{ fontWeight: '600' }}>
            {t.captureForm.recentlyUsed}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: theme.spacing.sm }}
          >
            {recentCards.map((code) => {
              const selected = code === value;
              return (
                <Pressable
                  key={code}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${code}, ${titled(names.currency(code))}`}
                  onPress={() => pick(code)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingVertical: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.lg,
                    borderWidth: selected ? 1.5 : 1,
                    borderColor: selected ? theme.color.brand : theme.color.border,
                    backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <FlagDisc code={code} size={34} />
                  <View>
                    <Text variant="body" style={{ fontWeight: '700' }}>
                      {code}
                    </Text>
                    <Text variant="micro" tone="muted" numberOfLines={1}>
                      {titled(names.currency(code))}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ height: 1, backgroundColor: theme.color.border }} />
        </View>
      )}

      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="body" tone="muted" style={{ fontWeight: '600' }}>
          {t.captureForm.allCurrencies}
        </Text>
        {rows.length === 0 ? (
          <Text
            variant="body"
            tone="muted"
            align="center"
            style={{ paddingVertical: theme.spacing.lg }}
          >
            {t.captureForm.noCurrencyMatch}
          </Text>
        ) : (
          rows.map((code, index) => {
            const selected = code === value;
            return (
              <Pressable
                key={code}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${code}, ${titled(names.currency(code))}`}
                onPress={() => pick(code)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.lg,
                  paddingVertical: theme.spacing.md,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: selected ? theme.color.brandSoft : 'transparent',
                  borderTopWidth: index === 0 || selected ? 0 : 1,
                  borderTopColor: theme.color.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <FlagDisc code={code} size={36} />
                <Text variant="body" style={{ width: 48, fontWeight: '700' }}>
                  {code}
                </Text>
                <Text variant="body" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                  {titled(names.currency(code))}
                </Text>
                <Radio selected={selected} />
              </Pressable>
            );
          })
        )}
      </View>
    </SheetOverlay>
  );
}

/** The currency's country flag in a round, softly ringed disc. */
function FlagDisc({ code, size }: { code: string; size: number }) {
  const theme = useTheme();
  const flag = flagFor(code);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.surfaceMuted,
        overflow: 'hidden',
      }}
    >
      {flag ? (
        <Text style={{ fontSize: size * 0.72, lineHeight: size }}>{flag}</Text>
      ) : (
        <Text variant="micro" style={{ fontWeight: '700' }}>
          {code}
        </Text>
      )}
    </View>
  );
}

/** A radio: a ring, filled with a brand dot when chosen. */
function Radio({ selected }: { selected: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: selected ? theme.color.brand : theme.color.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {selected ? (
        <View
          style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.color.brand }}
        />
      ) : null}
    </View>
  );
}
