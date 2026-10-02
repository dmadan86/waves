/**
 * The eye toggle's state — hide every money figure on a shared screen behind a
 * mask, remembered across opens. One key, shared by Home and Friends, so
 * shutting the money on one hides it on the other: it is the same question
 * ("can whoever is looking at my phone see what I owe?") wherever it is asked,
 * not a separate switch per screen.
 *
 * Reads once on mount (so a hidden balance stays hidden after a relaunch, not
 * flashing the number first) and writes on every toggle. Defaults to shown.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BALANCE_HIDDEN_KEY = 'dashboard:balanceHidden';

export function useBalanceHidden(): { hidden: boolean; ready: boolean; toggle: () => void } {
  const [hidden, setHidden] = useState(false);
  // `hidden` starts shown and the stored value arrives a frame or more later,
  // so without a gate the real number paints before the mask does. `ready`
  // flips once the read settles (success or failure) so the caller can hold a
  // skeleton or the shown figure until then.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(BALANCE_HIDDEN_KEY)
      .then((value) => {
        if (alive && value === '1') setHidden(true);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  const toggle = useCallback(() => {
    setHidden((was) => {
      const next = !was;
      void AsyncStorage.setItem(BALANCE_HIDDEN_KEY, next ? '1' : '0').catch(() => {});
      return next;
    });
  }, []);
  return { hidden, ready, toggle };
}
