/** "Rent goes up 5% on 10 Mar: 25,000 → 26,250. Apply?" with Apply and Not now. */

import { useRef, useState } from 'react';
import { View } from 'react-native';

import { Button, Row, Text, useTheme } from '@waves/ui';

import { StandardCard } from '@/components/standard';
import { useWealthMoney } from '@/components/wealth/parts';
import { useWealthWrites, usePersonalWealth } from '@/data/personalWealth';
import { usePersonalLedger } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { useToast } from '@/lib/toast';
import { skipRaise, useRaiseSkips } from '@/lib/raiseSkips';
import { raisePrompt, type RaisePrompt } from '@/lib/wealthPlan';

/** Every pending, not-dismissed increase across the active tenancies. */
export function useRaisePrompts(today: string, groupId?: string): RaisePrompt[] {
  const { tenancies } = usePersonalWealth(groupId);
  const { recurrings } = usePersonalLedger(groupId);
  const skips = useRaiseSkips();
  return tenancies
    .map((tn) => raisePrompt(tn, recurrings, today))
    .filter((p): p is RaisePrompt => p !== null && !skips.has(p.key));
}

export function RaiseCard({ prompt, groupId }: { prompt: RaisePrompt; groupId?: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const fmt = useWealthMoney();
  const writes = useWealthWrites(groupId);
  const toast = useToast();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const cur = prompt.rule.currency;
  const apply = (): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    writes
      .changeRent(prompt.rule, prompt.newAmount, prompt.from, prompt.anniversary)
      .then(() => skipRaise(prompt.key))
      // The card stays, so Apply can be tried again.
      .catch(() => toast.show(t.wealth.raiseFailed, 'negative'))
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };
  const date = new Date(`${prompt.anniversary}T12:00:00`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
  });
  return (
    <StandardCard style={{ gap: theme.spacing.md }}>
      <Text variant="body" style={{ fontWeight: '600' }}>
        {fill(t.wealth.raisePrompt, {
          pct: prompt.pct,
          date,
          old: fmt(prompt.oldAmount, cur),
          new: fmt(prompt.newAmount, cur),
        })}
      </Text>
      <Row style={{ gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button label={t.wealth.raiseApply} disabled={busy} onPress={apply} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={t.wealth.raiseNotNow}
            variant="secondary"
            disabled={busy}
            onPress={() => skipRaise(prompt.key)}
          />
        </View>
      </Row>
    </StandardCard>
  );
}
