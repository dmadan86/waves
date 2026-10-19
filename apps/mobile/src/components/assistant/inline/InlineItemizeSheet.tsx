/**
 * "Split by item", on the voice screen: every line of the scanned bill with a
 * row of people to tap, and each person's total updating as you go.
 *
 * The totals are the ledger's own split (`computeShares`, tax and extras shared
 * by what each person had), so what is shown is what gets written. The caller
 * saves (`onConfirm`) and reports a failure through `error`.
 */

import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { format, money, type CurrencyCode } from '@waves/core';
import { Button, Sheet, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import {
  claimants,
  itemizeTotals,
  toggleClaim,
  unclaimedCount,
  type Claims,
  type ItemizeDraft,
  type PersonChoice,
} from '@/lib/assistantInline';
import { PickChip } from './PickChip';

export interface InlineItemizeSheetProps {
  visible: boolean;
  draft: ItemizeDraft;
  people: readonly PersonChoice[];
  amount: bigint;
  currency: string;
  /** The id the expense will be written under: it seeds the remainder, so totals match the write. */
  seed: string;
  busy: boolean;
  error: string | null;
  onConfirm: (claims: Claims) => void;
  onClose: () => void;
}

export function InlineItemizeSheet({
  visible,
  draft,
  people,
  amount,
  currency,
  seed,
  busy,
  error,
  onConfirm,
  onClose,
}: InlineItemizeSheetProps) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.inline;
  const [claims, setClaims] = useState<Claims>({});
  const fmt = (minor: bigint): string => format(money(minor, currency as CurrencyCode), { locale });
  const left = unclaimedCount(draft, claims);
  const totals = useMemo(
    () => itemizeTotals(draft, claims, amount, currency, seed),
    [draft, claims, amount, currency, seed],
  );
  const nameOf = (id: string): string =>
    people.find((p) => p.id === id)?.isViewer
      ? s.you
      : (people.find((p) => p.id === id)?.name ?? '');
  const everyone = people.map((p) => p.id);

  return (
    <Sheet visible={visible} onClose={onClose} title={s.itemizeTitle} closeLabel={s.close}>
      <Text variant="caption" tone="muted">
        {s.itemizeHint}
      </Text>
      <ScrollView
        style={{ maxHeight: 360 }}
        contentContainerStyle={{ gap: theme.spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        {draft.items.map((item, index) => {
          const now = claims[index] ?? [];
          return (
            <View key={`${index}-${item.label}`} style={{ gap: theme.spacing.xs }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: theme.spacing.sm,
                }}
              >
                <Text numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
                  {item.label}
                </Text>
                <Text>{fmt(item.total)}</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
                {people.map((p) => (
                  <PickChip
                    key={p.id}
                    label={p.isViewer ? s.you : p.name}
                    selected={now.includes(p.id)}
                    disabled={busy}
                    accessibilityLabel={fill(s.itemChipA11y, {
                      name: p.isViewer ? s.you : p.name,
                      item: item.label,
                    })}
                    onPress={() => setClaims((c) => toggleClaim(c, index, p.id))}
                  />
                ))}
                <PickChip
                  label={s.everyone}
                  selected={now.length === everyone.length}
                  disabled={busy}
                  accessibilityLabel={fill(s.everyoneA11y, { item: item.label })}
                  onPress={() =>
                    setClaims((c) => ({
                      ...c,
                      [index]: now.length === everyone.length ? [] : everyone,
                    }))
                  }
                />
              </View>
            </View>
          );
        })}
      </ScrollView>
      {draft.charges > 0n ? (
        <Text variant="caption" tone="muted">
          {fill(s.itemizeCharges, { amount: fmt(draft.charges) })}
        </Text>
      ) : null}
      <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
        {totals ? (
          claimants(claims, draft).map((id) => (
            <View key={id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text>{nameOf(id)}</Text>
              <Text style={{ fontWeight: '700' }}>{fmt(totals.get(id) ?? 0n)}</Text>
            </View>
          ))
        ) : (
          <Text variant="caption" tone="muted">
            {fill(s.itemizeLeft, { count: left })}
          </Text>
        )}
      </View>
      {error ? (
        <Text
          variant="caption"
          style={{ color: theme.color.negative }}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
      <Button
        label={error ? s.retry : s.itemizeSave}
        fullWidth
        disabled={!totals || busy}
        onPress={() => onConfirm(claims)}
      />
    </Sheet>
  );
}
