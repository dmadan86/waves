/**
 * Everything "Coming up" reads, for Personal or one couple/family space: the due sources (the
 * space's recurring rules and the group's bills), the big-bills fund, and the clock.
 */

import { useMemo } from 'react';

import { frequencyOf, type GroupRecurringRule, type PersonalRecurring } from '@waves/core';

import { todayIso, usePersonalLedger } from '@/data/personal';
import { usePersonalWealth } from '@/data/personalWealth';
import { usePersonalVehicles } from '@/data/vehicles';
import { useAuth } from '@/lib/auth';
import { kindName } from '@/lib/vehicleText';
import { regionOf } from '@/lib/wealthPlan';
import { useGroupRecurring } from '@/data/groupRecurring';
import { useStrings, type UiStrings } from '@/i18n';
import { useDefaultCurrency } from '@/lib/currency';
import { frequencyLabel } from '@/lib/frequencyLabel';
import {
  classifyKind,
  FUND_CATEGORY,
  fundSoFar,
  vehicleSources,
  type DueSource,
} from '@/lib/moneyCalendar';

const EMPTY_LEDGER = { recurrings: [], txns: [] } as const;

const catLabel = (t: UiStrings, id: string | null): string =>
  id ? ((t.categories as Record<string, string>)[id] ?? '') : '';

export function personalSource(
  rule: PersonalRecurring,
  t: UiStrings,
  /** Rent rules open their property, where Record rent already lives. */
  rentHref?: string,
): DueSource {
  const income = rule.txnKind === 'income';
  const label = catLabel(t, rule.category);
  return {
    id: rule.id,
    title: rule.note?.trim() || label || t.comingUp.addDueDate,
    sub: [label, frequencyLabel(t, frequencyOf(rule), rule.interval)].filter(Boolean).join(' · '),
    kind: classifyKind(rule.category, income, !!rule.tenancyId),
    amount: rule.amount,
    currency: rule.currency,
    cadence: rule.cadence,
    interval: rule.interval,
    secondDay: rule.secondDay,
    anchorDate: rule.anchorDate,
    nextDate: rule.nextDate,
    endDate: rule.endDate,
    autoPay: rule.autoPost,
    income,
    reserved: rule.category === FUND_CATEGORY,
    href: rentHref ?? `/personal/entry?recurringId=${rule.id}`,
  };
}

export function groupSource(rule: GroupRecurringRule, t: UiStrings): DueSource {
  const label = catLabel(t, rule.category);
  return {
    id: rule.id,
    title: rule.description.trim() || label,
    sub: [label, frequencyLabel(t, frequencyOf(rule), rule.interval)].filter(Boolean).join(' · '),
    kind: classifyKind(rule.category, false, false),
    amount: rule.amount,
    currency: rule.currency,
    cadence: rule.cadence,
    interval: rule.interval,
    secondDay: rule.secondDay,
    anchorDate: rule.anchorDate,
    nextDate: rule.nextDate,
    endDate: rule.endDate,
    autoPay: false,
    income: false,
    reserved: false,
    href: `/group/${rule.groupId}/recurring-edit?ruleId=${rule.id}`,
  };
}

/** `ledgerGroupId`: the space whose end-to-end encrypted records (rent, shared rules) to read. */
export function useComingUp(opts: { groupId?: string; ledgerGroupId?: string; currency?: string }) {
  const { t } = useStrings();
  const personalCurrency = useDefaultCurrency();
  const dc = opts.currency ?? personalCurrency;
  const own = usePersonalLedger(opts.ledgerGroupId);
  // A space without shared records has none of its own: never fall back to Personal's ledger.
  const ledger = opts.groupId && !opts.ledgerGroupId ? EMPTY_LEDGER : own;
  const { rules } = useGroupRecurring(opts.groupId ?? '');
  const { tenancies } = usePersonalWealth(opts.ledgerGroupId);
  const { vehicles } = usePersonalVehicles(opts.ledgerGroupId);
  const { profile } = useAuth();
  const region = regionOf(profile?.country_code);
  const today = todayIso();
  return useMemo(() => {
    const live = ledger.recurrings.filter((r) => r.active);
    const sources: DueSource[] = [
      ...live.map((r) => {
        const property = r.tenancyId
          ? tenancies.find((x) => x.id === r.tenancyId)?.propertyId
          : undefined;
        const space = opts.ledgerGroupId ? `?space=${opts.ledgerGroupId}` : '';
        return personalSource(r, t, property ? `/rentals/${property}${space}` : undefined);
      }),
      ...(opts.groupId
        ? rules.filter((r) => r.status === 'active').map((r) => groupSource(r, t))
        : []),
    ];
    // Vehicles live in the same records as rent: none in a space without shared records.
    if (!opts.groupId || opts.ledgerGroupId)
      sources.push(
        ...vehicleSources(vehicles, today, dc, (_v, r) =>
          kindName(t.vehicles, r.kind, region, r.label),
        ),
      );
    const fundRules = new Set(live.filter((r) => r.category === FUND_CATEGORY).map((r) => r.id));
    return {
      ledgerRules: ledger.recurrings,
      groupRules: rules,
      txns: ledger.txns,
      sources,
      dc,
      today,
      fundRules,
      fund: fundSoFar(ledger.txns, fundRules, dc),
    };
  }, [
    ledger.recurrings,
    ledger.txns,
    rules,
    tenancies,
    vehicles,
    region,
    opts.groupId,
    opts.ledgerGroupId,
    t,
    dc,
    today,
  ]);
}
