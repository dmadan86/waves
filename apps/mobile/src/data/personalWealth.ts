/** Investments, rental properties and tenancies, read from and written to the personal ledger store. */

import { useMemo } from 'react';
import { randomUUID } from 'expo-crypto';

import {
  decodeInvestment,
  decodeProperty,
  decodeTenancy,
  encodeInvestment,
  encodeProperty,
  encodeRecurring,
  encodeTenancy,
  encodeTxn,
  type CurrencyCode,
  type InvestmentType,
  type PersonalInvestment,
  type PersonalProperty,
  type PersonalRecurring,
  type PersonalTenancy,
  type PropertyType,
  type RentFrequency,
} from '@waves/core';

import {
  useDeletePersonalRecord,
  usePersonalRecords,
  useUpsertPersonalRecord,
  todayIso,
} from '@/data/personal';
import {
  cadenceFor,
  firstDue,
  rentAnchor,
  investmentCategory,
  rentRaiseDates,
  rulesToCloseOnLeave,
} from '@/lib/wealthPlan';
import { useEntitlement } from '@/lib/useEntitlement';

let pendingInvestments = 0;
let pendingProperties = 0;
export const FREE_CAP_ERROR = 'FREE_WEALTH_CAP';

export interface PersonalWealth {
  readonly investments: readonly PersonalInvestment[];
  readonly properties: readonly PersonalProperty[];
  readonly tenancies: readonly PersonalTenancy[];
}

export function usePersonalWealth(): PersonalWealth {
  const records = usePersonalRecords();
  return useMemo(() => {
    const investments: PersonalInvestment[] = [];
    const properties: PersonalProperty[] = [];
    const tenancies: PersonalTenancy[] = [];
    for (const r of records) {
      if (r.record_kind === 'investment') investments.push(decodeInvestment(r.id, r.data));
      else if (r.record_kind === 'property') properties.push(decodeProperty(r.id, r.data));
      else if (r.record_kind === 'tenancy') tenancies.push(decodeTenancy(r.id, r.data));
    }
    investments.sort((a, b) => a.name.localeCompare(b.name));
    properties.sort((a, b) => a.name.localeCompare(b.name));
    return { investments, properties, tenancies };
  }, [records]);
}

export interface InvestmentDraft {
  type: InvestmentType;
  name: string;
  currency: CurrencyCode;
  /** 0 = no schedule. */
  amount: bigint;
  frequency: RentFrequency;
  day: number;
  autoPost: boolean;
  openingInvested: bigint;
  currentValue: bigint | null;
  taxWrapper: boolean;
  maturityDate: string | null;
  /** Weekly and fortnightly schedules start on a date rather than a day of the month. */
  startDate: string | null;
  today: string;
}

export interface RentalDraft {
  type: PropertyType;
  name: string;
  currency: CurrencyCode;
  today: string;
  tenant: null | {
    name: string;
    phone: string;
    rent: bigint;
    frequency: RentFrequency;
    day: number;
    deposit: bigint;
    startDate: string;
    endDate: string | null;
    escalationPct: number | null;
  };
}

export function useWealthWrites() {
  const upsert = useUpsertPersonalRecord();
  const del = useDeletePersonalRecord();
  const records = usePersonalRecords();
  const { isPro } = useEntitlement();
  const put = (
    recordKind: Parameters<typeof upsert.mutateAsync>[0]['recordKind'],
    recordId: string,
    data: Record<string, unknown>,
  ) => upsert.mutateAsync({ recordId, recordKind, data });

  const rentRule = (
    id: string,
    t: {
      tenancyId: string;
      amount: bigint;
      currency: CurrencyCode;
      frequency: RentFrequency;
      anchor: string;
      note: string;
    },
  ): [string, Record<string, unknown>] => [
    id,
    encodeRecurring({
      txnKind: 'income',
      amount: t.amount,
      currency: t.currency,
      category: 'inc.rent',
      note: t.note,
      ...cadenceFor(t.frequency),
      secondDay: null,
      anchorDate: t.anchor,
      nextDate: t.anchor,
      endDate: null,
      // Rent is never auto-posted: the landlord confirms each payment.
      autoPost: false,
      active: true,
      tenancyId: t.tenancyId,
    }),
  ];

  return {
    isPending: upsert.isPending,

    async createInvestment(d: InvestmentDraft): Promise<string> {
      const count = records.filter(
        (r) => r.record_kind === 'investment' && decodeInvestment(r.id, r.data).status === 'active',
      ).length;
      if (!isPro && count + pendingInvestments >= 3) throw new Error(FREE_CAP_ERROR);
      pendingInvestments += 1;
      try {
        const id = randomUUID();
        await put(
          'investment',
          id,
          encodeInvestment({
            type: d.type,
            name: d.name,
            currency: d.currency,
            openingInvested: d.openingInvested,
            openingAsOf: d.openingInvested > 0n ? d.today : null,
            currentValue: d.currentValue,
            valueAsOf: d.currentValue !== null ? d.today : null,
            maturityDate: d.maturityDate,
            taxWrapper: d.taxWrapper,
            status: 'active',
            note: null,
          }),
        );
        if (d.amount > 0n) {
          const anchor = d.startDate ?? firstDue(d.today, d.day);
          await put(
            'recurring',
            randomUUID(),
            encodeRecurring({
              txnKind: 'expense',
              amount: d.amount,
              currency: d.currency,
              category: investmentCategory(d.type),
              note: d.name,
              ...cadenceFor(d.frequency),
              secondDay: null,
              anchorDate: anchor,
              nextDate: anchor,
              endDate: null,
              autoPost: d.autoPost,
              active: true,
              investmentId: id,
            }),
          );
        }
        return id;
      } finally {
        pendingInvestments -= 1;
      }
    },

    /** Insurance with no payout stays an ordinary bill: a plain recurring expense. */
    async createPlainBill(d: InvestmentDraft): Promise<void> {
      if (d.amount <= 0n) return;
      const anchor = d.startDate ?? firstDue(d.today, d.day);
      await put(
        'recurring',
        randomUUID(),
        encodeRecurring({
          txnKind: 'expense',
          amount: d.amount,
          currency: d.currency,
          category: null,
          note: d.name,
          ...cadenceFor(d.frequency),
          secondDay: null,
          anchorDate: anchor,
          nextDate: anchor,
          endDate: null,
          autoPost: d.autoPost,
          active: true,
        }),
      );
    },

    saveInvestment: (inv: PersonalInvestment) => {
      const { id, ...rest } = inv;
      return put('investment', id, encodeInvestment(rest));
    },

    /** Money in (an expense entry) or out (an income entry) of one investment. */
    addEntry: (
      inv: PersonalInvestment,
      amount: bigint,
      direction: 'in' | 'out',
      date: string,
      note: string,
    ) =>
      put(
        'txn',
        randomUUID(),
        encodeTxn({
          kind: direction === 'in' ? 'expense' : 'income',
          amount,
          currency: inv.currency,
          category: investmentCategory(inv.type),
          note,
          date,
          loanId: null,
          recurringId: null,
          investmentId: inv.id,
        }),
      ),

    setRuleActive: (rule: PersonalRecurring, active: boolean) => {
      const { id, ...rest } = rule;
      return put('recurring', id, encodeRecurring({ ...rest, active }));
    },

    async createRental(d: RentalDraft): Promise<string> {
      const count = records.filter(
        (r) => r.record_kind === 'property' && decodeProperty(r.id, r.data).status === 'active',
      ).length;
      if (!isPro && count + pendingProperties >= 1) throw new Error(FREE_CAP_ERROR);
      pendingProperties += 1;
      try {
        const propertyId = randomUUID();
        await put(
          'property',
          propertyId,
          encodeProperty({
            type: d.type,
            name: d.name,
            locality: null,
            currency: d.currency,
            status: 'active',
            note: null,
          }),
        );
        if (d.tenant) {
          const t = d.tenant;
          const tenancyId = randomUUID();
          await put(
            'tenancy',
            tenancyId,
            encodeTenancy({
              propertyId,
              unit: null,
              tenantName: t.name,
              tenantPhone: t.phone.trim() || null,
              depositHeld: t.deposit,
              rentFrequency: t.frequency,
              startDate: t.startDate,
              endDate: t.endDate,
              escalationPct: t.escalationPct,
              status: 'active',
              endedOn: null,
              depositReturned: null,
              depositKept: null,
              note: null,
            }),
          );
          const [rid, data] = rentRule(randomUUID(), {
            tenancyId,
            amount: t.rent,
            currency: d.currency,
            frequency: t.frequency,
            anchor: rentAnchor(t.startDate, t.day, d.today, t.frequency),
            note: `Rent · ${d.name}`,
          });
          await put('recurring', rid, data);
        }
        return propertyId;
      } finally {
        pendingProperties -= 1;
      }
    },

    /** Each payment is its own entry with a fresh id, so part payments never overwrite one another. */
    recordRent: (
      rule: PersonalRecurring,
      propertyId: string,
      amount: bigint,
      date: string,
      label: string,
    ) =>
      put(
        'txn',
        randomUUID(),
        encodeTxn({
          kind: 'income',
          amount,
          currency: rule.currency,
          category: 'inc.rent',
          // A generic note: the tenant's name never goes into an entry.
          note: `Rent · ${label}`,
          date,
          loanId: null,
          recurringId: rule.id,
          propertyId,
        }),
      ),

    addExpense: (
      property: PersonalProperty,
      amount: bigint,
      date: string,
      note: string,
      category: string | null,
    ) =>
      put(
        'txn',
        randomUUID(),
        encodeTxn({
          kind: 'expense',
          amount,
          currency: property.currency,
          category,
          note: note.trim() || `${property.name}`,
          date,
          loanId: null,
          recurringId: null,
          propertyId: property.id,
        }),
      ),

    /** A rent raise: end the old rule the day before, start a new one on the same tenancy. */
    async changeRent(old: PersonalRecurring, newAmount: bigint, from: string): Promise<void> {
      const { due, oldEnd } = rentRaiseDates(old, from);
      const { id, ...rest } = old;
      await put(
        'recurring',
        id,
        encodeRecurring({
          ...rest,
          active: oldEnd >= todayIso() ? rest.active : false,
          endDate: oldEnd,
        }),
      );
      await put(
        'recurring',
        randomUUID(),
        encodeRecurring({
          ...rest,
          carried: undefined,
          amount: newAmount,
          anchorDate: due,
          nextDate: due,
          endDate: null,
        }),
      );
    },

    /** The tenant left. The returned advance is held money, so no entry; a kept part is income. */
    async tenantLeft(
      tn: PersonalTenancy,
      property: PersonalProperty,
      rules: readonly PersonalRecurring[],
      returned: bigint,
      kept: bigint,
      endedOn: string,
    ): Promise<void> {
      const { id, ...rest } = tn;
      await put(
        'tenancy',
        id,
        encodeTenancy({
          ...rest,
          status: 'closed',
          endedOn,
          depositReturned: returned,
          depositKept: kept,
        }),
      );
      for (const r of rulesToCloseOnLeave(rules, endedOn)) {
        const { id: rid, ...rr } = r;
        await put('recurring', rid, encodeRecurring({ ...rr, active: false, endDate: endedOn }));
      }
      if (kept > 0n) {
        await put(
          'txn',
          randomUUID(),
          encodeTxn({
            kind: 'income',
            amount: kept,
            currency: property.currency,
            category: 'inc.rent',
            note: `Deposit kept · ${property.name}`,
            date: endedOn,
            loanId: null,
            recurringId: null,
            propertyId: property.id,
          }),
        );
      }
    },

    /** Blank the personal details first, so the tombstone holds no name or phone. */
    async deleteTenancy(tn: PersonalTenancy): Promise<void> {
      const { id, ...rest } = tn;
      await put('tenancy', id, encodeTenancy({ ...rest, tenantName: '', tenantPhone: null }));
      await del.mutateAsync(id);
    },

    deleteRecord: (id: string) => del.mutateAsync(id),
  };
}
