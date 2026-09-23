import { useRef, useState } from 'react';

import { nudgeToSettle } from '@/data/api';
import { useStrings, type UiStrings } from '@/i18n';
import { nudgeOutcome, nudgeSent, type NudgeOutcome } from '@/lib/nudgeOutcome';

export interface NudgeTarget {
  readonly groupId: string;
  readonly memberId: string;
  readonly currency: string;
}

/** Send one reminder and say how it went. Never throws. */
export async function sendNudge(target: NudgeTarget, t: UiStrings): Promise<NudgeOutcome> {
  try {
    await nudgeToSettle({
      groupId: target.groupId,
      toMemberId: target.memberId,
      currency: target.currency,
    });
    return nudgeSent(t);
  } catch (error) {
    return nudgeOutcome(error, t);
  }
}

/**
 * The remind button's state: `send` fires once (a second tap while one is in
 * flight is ignored), `outcome` is the verdict once it lands.
 */
export function useNudge(target: NudgeTarget): {
  send: () => void;
  pending: boolean;
  outcome: NudgeOutcome | null;
} {
  const { t } = useStrings();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<NudgeOutcome | null>(null);
  // A ref, not the `pending` state: two taps in one frame both read the state
  // before it re-renders, and would send two reminders.
  const inFlight = useRef(false);
  const send = (): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    void sendNudge(target, t).then((result) => {
      inFlight.current = false;
      setPending(false);
      setOutcome(result);
    });
  };
  return { send, pending, outcome };
}
