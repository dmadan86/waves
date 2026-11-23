/**
 * Headless: keeps the OS holding the right plan notifications. Re-plans when the
 * app comes to the front and whenever the personal ledger (or language, currency,
 * amounts-hidden) changes — which covers every record upsert, local or synced.
 */

import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { format, money, resolveCategory } from '@waves/core';

import { usePersonalLedger } from '@/data/personal';
import { useStrings } from '@/i18n';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { useAuth } from '@/lib/auth';
import { useDefaultCurrency } from '@/lib/currency';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { reportHandled } from '@/lib/observability';

import { planNudgeText } from './render';
import { syncPlanNudges } from './run';

export function usePlanNudgePass(): () => void {
  const { session } = useAuth();
  const ownerId = session?.user?.id ?? '';
  const { t, locale } = useStrings();
  const { hidden } = usePersonalAmountsHidden();
  const currency = useDefaultCurrency();
  const { txns, recurrings, budgets } = usePersonalLedger();

  return useCallback(() => {
    if (!ownerId) return;
    const monthName = (month: string): string => {
      try {
        return dateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
          new Date(`${month}-01T00:00:00Z`),
        );
      } catch {
        return month;
      }
    };
    void syncPlanNudges({
      ownerId,
      now: Date.now(),
      txns,
      recurrings,
      budgets,
      currency,
      textKey: `${locale}|${hidden ? 1 : 0}`,
      text: (item) =>
        planNudgeText(item, {
          s: t.notifications.plan,
          hidden,
          fmt: (amount) => format(money(amount, currency), { locale }),
          categoryName: (key) =>
            t.categories[
              (resolveCategory(key, null).builtinId ?? 'other') as keyof typeof t.categories
            ] ?? t.categories.other,
          monthName,
        }),
    }).catch((error: unknown) => reportHandled(error, 'planNudge.sync'));
  }, [ownerId, locale, hidden, currency, txns, recurrings, budgets, t]);
}

export function PlanNudge() {
  const pass = usePlanNudgePass();
  const passRef = useRef(pass);
  useEffect(() => {
    passRef.current = pass;
  }, [pass]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') passRef.current();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    pass();
  }, [pass]);

  return null;
}
