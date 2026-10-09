/**
 * The credit a rate source's terms require wherever its rate is shown.
 *
 * Today that is only ExchangeRate-API's open access ("Rates By Exchange Rate
 * API", linked). One component so every surface that shows a fetched rate — the
 * expense's rate line and sheet, a trip's pinned rates, the new-group form —
 * credits it the same way, and none can forget to. Renders nothing for any
 * other source.
 */

import { Linking, Pressable } from 'react-native';

import type { FxRecord } from '@waves/core';
import { Text } from '@waves/ui';

import { rateAttribution } from '@/lib/fxLine';

export function RateAttribution({
  fx,
  tone = 'muted',
}: {
  fx: Pick<FxRecord, 'source'> | null | undefined;
  tone?: 'muted' | 'faint';
}): React.JSX.Element | null {
  const credit = rateAttribution(fx);
  if (!credit) return null;
  return (
    <Pressable
      onPress={() => void Linking.openURL(credit.url)}
      accessibilityRole="link"
      hitSlop={6}
    >
      <Text variant="micro" tone={tone} style={{ textDecorationLine: 'underline' }}>
        {credit.text}
      </Text>
    </Pressable>
  );
}
