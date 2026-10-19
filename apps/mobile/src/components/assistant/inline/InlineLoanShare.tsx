/**
 * "Share it with Ravi", done in the card: the loan was written when the person
 * said yes, and this shares it (a debt in a 1:1 group they can see and settle)
 * through the same `useShareLoan` write the loans screen uses. It reports the
 * outcome right here, and a failure keeps the loan and offers "Try again".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { PersonalLoan } from '@waves/core';
import { Text, useTheme } from '@waves/ui';

import { useShareLoan } from '@/data/syncedLoans';
import { fill, useStrings } from '@/i18n';
import { shareLoanInline } from '@/lib/assistantInline';
import { SmallAction } from './SmallAction';

type Status = 'sharing' | 'shared' | 'failed';

export function InlineLoanShare({
  loan,
  loans,
}: {
  loan: PersonalLoan;
  loans: readonly PersonalLoan[];
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.inline;
  const share = useShareLoan(loans);
  const lock = useRef(false);
  const started = useRef(false);
  const [status, setStatus] = useState<Status>('sharing');
  const name = loan.counterpart;

  const run = useCallback(async (): Promise<void> => {
    setStatus('sharing');
    const out = await shareLoanInline(lock, () =>
      share.mutateAsync({ loan, person: { name: loan.counterpart } }),
    );
    if (out === 'busy') return;
    setStatus(out === 'shared' ? 'shared' : 'failed');
  }, [share, loan]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, minHeight: 44 }}
      accessibilityLiveRegion="polite"
    >
      {status === 'sharing' ? (
        <>
          <ActivityIndicator color={theme.color.brand} />
          <Text tone="muted">{fill(s.loanSharing, { name })}</Text>
        </>
      ) : status === 'shared' ? (
        <Text style={{ color: theme.color.brand, fontWeight: '700', flex: 1 }}>
          {fill(s.loanShared, { name })}
        </Text>
      ) : (
        <>
          <Text style={{ flex: 1, color: theme.color.negative }}>
            {fill(s.loanShareFailed, { name })}
          </Text>
          <SmallAction label={s.retry} onPress={() => void run()} />
        </>
      )}
    </View>
  );
}
