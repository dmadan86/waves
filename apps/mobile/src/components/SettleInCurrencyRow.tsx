/**
 * "Settle in ₹" — whether a group counts its foreign bills in its own currency,
 * each at the rate saved on that bill (ADR-003 amendment).
 *
 * New groups start with it on. An existing group opts in here, and only once it
 * is ready: every foreign bill has a rate, and nobody has settled in another
 * currency. Until then the row says what is missing rather than offering a
 * switch the server would refuse. Once a settlement has been recorded with it
 * on, it stays on — that settlement paid down debts that only exist converted.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { Card, ListRow, Text, Toggle, useTheme } from '@waves/ui';

import { useGroupCurrencyReadiness, useSetGroupConvert } from '@/data/hooks';
import { fill, useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { convertSwitchBlocks, type ConvertBlock } from '@/lib/settleCurrency';

export function SettleInCurrencyRow({
  groupId,
  currency,
  on,
  isAdmin,
  settlementCount,
}: {
  groupId: string;
  currency: string;
  on: boolean;
  isAdmin: boolean;
  /** Settlements in the group that are not cancelled. */
  settlementCount: number;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const readiness = useGroupCurrencyReadiness(groupId, !on);
  const setConvert = useSetGroupConvert(groupId);
  const [error, setError] = useState<string | null>(null);

  const blocks = convertSwitchBlocks({
    on,
    isAdmin,
    readiness: readiness.data ?? [],
    settlementCount,
  });
  // Off and the server has not answered yet: nothing is known to be missing,
  // but nothing is known to be ready either, so hold the switch.
  const waiting = !on && !readiness.data;
  const disabled = blocks.length > 0 || waiting || setConvert.isPending;

  const say = (block: ConvertBlock): string => {
    switch (block.kind) {
      case 'adminOnly':
        return t.fx.convertAdminOnly;
      case 'locked':
        return fill(t.fx.convertLocked, { currency });
      case 'missingRates':
        return fill(t.fx.convertNeedsRates, { count: block.count, currency: block.currency });
      case 'foreignSettlements':
        return fill(t.fx.convertForeignSettlements, { currency: block.currency });
    }
  };

  const toggle = (next: boolean): void => {
    setError(null);
    setConvert.mutate(next, {
      onError: (caught) => setError(friendlyError(caught, t.couldNotSave, 'settings.convert')),
    });
  };

  const title = fill(t.fx.convertTitle, { currency });
  return (
    <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
      <ListRow
        title={title}
        subtitle={fill(t.fx.convertBody, { currency })}
        trailing={
          <Toggle
            value={on}
            disabled={disabled}
            onValueChange={toggle}
            accessibilityLabel={title}
          />
        }
      />
      {blocks.length > 0 || error ? (
        <View style={{ gap: theme.spacing.xs, paddingBottom: theme.spacing.md }}>
          {blocks.map((block) => (
            <Text
              key={`${block.kind}:${'currency' in block ? block.currency : ''}`}
              variant="caption"
              tone="muted"
            >
              {say(block)}
            </Text>
          ))}
          {error ? (
            <Text variant="caption" tone="negative">
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
