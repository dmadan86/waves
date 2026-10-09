/**
 * "Settle in ₹" — whether a group counts its foreign bills in its own currency,
 * each at the rate saved on that bill (ADR-003 amendment).
 *
 * New groups start with it on. An existing group opts in here, and only once it
 * is ready: every foreign bill has a rate, and nobody has settled in another
 * currency. Until then the row says what is missing rather than offering a
 * switch the server would refuse. Once a settlement has been recorded with it
 * on, it stays on — that settlement paid down debts that only exist converted.
 *
 * Only an admin can flip it, so only an admin's device asks the server whether
 * the group is ready; everyone else sees the state and "only an admin". The demo
 * group is a sample on this device, not a ledger the server holds, so it has no
 * switch at all.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, ListRow, Text, Toggle, useTheme } from '@waves/ui';

import { useGroupCurrencyReadiness, useSetGroupConvert } from '@/data/hooks';
import { isDemoGroupId } from '@/demo/ids';
import { fill, plural, useStrings } from '@/i18n';
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
  const { t, locale } = useStrings();
  const demo = isDemoGroupId(groupId);
  // Asked only of an admin's device, only while the switch is off: nobody else
  // can act on the answer.
  const readiness = useGroupCurrencyReadiness(groupId, !on && isAdmin && !demo);
  const setConvert = useSetGroupConvert(groupId);
  const [error, setError] = useState<string | null>(null);

  if (demo) return null;

  const blocks = convertSwitchBlocks({
    on,
    isAdmin,
    readiness: readiness.data ?? [],
    settlementCount,
  });
  // Off, an admin, and the server has not answered yet (or could not): nothing
  // is known to be missing, but nothing is known to be ready either, so hold
  // the switch — and when the check failed, say so with a retry rather than
  // leaving a switch that is silently dead.
  const readinessFailed = !on && isAdmin && readiness.isError;
  const waiting = !on && isAdmin && !readiness.data;
  const disabled = blocks.length > 0 || waiting || setConvert.isPending;

  const say = (block: ConvertBlock): string => {
    switch (block.kind) {
      case 'adminOnly':
        return t.fx.convertAdminOnly;
      case 'locked':
        return fill(t.fx.convertLocked, { currency });
      case 'missingRates':
        return fill(plural(locale, block.count, t.fx.convertNeedsRates), {
          currency: block.currency,
        });
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
      {blocks.length > 0 || error || readinessFailed ? (
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
          {readinessFailed ? (
            <View style={{ gap: theme.spacing.xs, alignItems: 'flex-start' }}>
              <Text variant="caption" tone="negative" accessibilityLiveRegion="polite">
                {t.fx.convertReadinessError}
              </Text>
              <Button
                label={t.retry}
                size="sm"
                variant="secondary"
                disabled={readiness.isFetching}
                onPress={() => void readiness.refetch()}
              />
            </View>
          ) : null}
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
