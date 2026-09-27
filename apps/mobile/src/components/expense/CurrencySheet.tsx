/**
 * "Choose currency" — the one picker every screen that asks for a currency uses:
 * a search over code, name and country, the few currencies this person reaches
 * for as cards along the top, then every offered currency as a row — its flag,
 * code and name, and a radio.
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
  options,
  title,
}: {
  value: string;
  onPick: (code: string) => void;
  onClose: () => void;
  /** Which currencies may be picked; every offered currency by default. */
  options?: readonly string[];
  /** The sheet's heading, when the choice has a name of its own ("Settles in"). */
  title?: string;
}): React.JSX.Element {
  const { t } = useStrings();
  return (
    <SheetOverlay title={title ?? t.captures.currencyPickerTitle} onClose={onClose}>
      <CurrencyChoices value={value} onPick={onPick} options={options} />
    </SheetOverlay>
  );
}

/**
 * The picker itself — search, the recent cards and the full list — without a
 * sheet around it, for a place that already stands inside one (the quick
 * expense sheet, a trip rate's sheet), where a second modal cannot be stacked
 * on the first. Everywhere else, `CurrencySheet` wraps it.
 */
export function CurrencyChoices({
  value,
  onPick,
  options,
}: {
  value: string;
  onPick: (code: string) => void;
  /** Which currencies may be picked; every offered currency by default. */
  options?: readonly string[];
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

  const offered: readonly string[] = options ?? COMMON_CURRENCIES;
  // What this person has picked, in the order they picked it. Only before
  // there is any history does it fall back to the current currency and the
  // head of the offered list.
  const recentCards = useMemo(() => {
    const picked = recent.filter((code) => offered.includes(code));
    const seed = picked.length > 0 ? picked : [value, ...offered];
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
    <View style={{ gap: theme.spacing.md }}>
      <Row
        style={{
          alignItems: 'center',
          gap: theme.spacing.md,
          height: 44,
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
          style={{ flex: 1, fontSize: 15, color: theme.color.text, paddingVertical: 0 }}
        />
      </Row>

      {needle ? null : (
        <View style={{ gap: theme.spacing.sm }}>
          <Text style={SECTION_LABEL(theme)}>{t.captureForm.recentlyUsed}</Text>
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
                    paddingVertical: 8,
                    paddingStart: theme.spacing.sm,
                    paddingEnd: theme.spacing.md,
                    borderRadius: 14,
                    borderWidth: selected ? 1.5 : 1,
                    borderColor: selected ? theme.color.brand : theme.color.border,
                    backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <FlagDisc code={code} size={24} />
                  <View>
                    <Text
                      style={{
                        fontSize: 14,
                        lineHeight: 18,
                        fontWeight: '700',
                        color: theme.color.text,
                      }}
                    >
                      {code}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 11, lineHeight: 14, color: theme.color.textMuted }}
                    >
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

      <View style={{ gap: 4 }}>
        <Text style={SECTION_LABEL(theme)}>{t.captureForm.allCurrencies}</Text>
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
            // A hairline between rows, starting at the code rather than under
            // the flag, and never against the lit row's tint.
            const rule = index > 0 && !selected && rows[index - 1] !== value;
            return (
              <View key={code}>
                {rule ? (
                  <View
                    style={{
                      height: 1,
                      marginStart: theme.spacing.md + ROW_FLAG + theme.spacing.md,
                      marginEnd: theme.spacing.md,
                      backgroundColor: theme.color.border,
                    }}
                  />
                ) : null}
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${code}, ${titled(names.currency(code))}`}
                  onPress={() => pick(code)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    minHeight: 44,
                    paddingVertical: 6,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: 12,
                    backgroundColor: selected ? theme.color.brandSoft : 'transparent',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <FlagDisc code={code} size={ROW_FLAG} />
                  <Text
                    style={{ width: 40, fontSize: 15, fontWeight: '700', color: theme.color.text }}
                  >
                    {code}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ flex: 1, fontSize: 15, color: theme.color.textMuted }}
                  >
                    {titled(names.currency(code))}
                  </Text>
                  <Radio selected={selected} />
                </Pressable>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

/** The currency's country flag on its own, no disc behind it. */
function FlagDisc({ code, size }: { code: string; size: number }) {
  const flag = flagFor(code);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
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
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: selected ? theme.color.brand : theme.color.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {selected ? (
        <View
          style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.color.brand }}
        />
      ) : null}
    </View>
  );
}

/** The flag's box in a list row. */
const ROW_FLAG = 26;

/** "Recently used" / "All currencies": small, quiet, a little weight. */
const SECTION_LABEL = (theme: ReturnType<typeof useTheme>) =>
  ({ fontSize: 14, lineHeight: 18, fontWeight: '500', color: theme.color.textMuted }) as const;
