/** Investments, rental properties and tenancies, read from and written to the personal ledger store. */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import {
  decodeInvestment,
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

import { useGroup } from '@/data/hooks';
import { fill, useStrings } from '@/i18n';
import {
  useDeletePersonalRecord,
  useGroupRecords,
  usePersonalRecords,
  useUpsertPersonalRecord,
  todayIso,
} from '@/data/personal';
import { useViewerId } from '@/lib/auth';
import {
  decodeWealth,
  myMemberIdFrom,
  ownActiveProperties,
  rentEntryId,
  type PersonalWealth,
  selectRentalRecords,
  type RentalRecord,
} from '@/lib/rentalScope';
import { clockId, e2eeSpace, useFormerCouples } from '@/e2ee/runtime';
import { isFormer } from '@/e2ee/space';
import {
  cadenceFor,
  firstDue,
  rentAnchor,
  investmentCategory,
  raiseRuleId,
  rentRaiseDates,
  rulesToCloseOnLeave,
} from '@/lib/wealthPlan';
import { useEntitlement } from '@/lib/useEntitlement';

export type { PersonalWealth };

let pendingInvestments = 0;
let pendingProperties = 0;
export const FREE_CAP_ERROR = 'FREE_WEALTH_CAP';

export interface RentalStore {
  readonly records: readonly RentalRecord[];
  readonly upsert: (
    recordId: string,
    recordKind: 'investment' | 'property' | 'tenancy' | 'recurring' | 'txn',
    data: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly del: (recordId: string) => Promise<unknown>;
  readonly isPending: boolean;
}

/**
 * Where a rentals screen reads and writes: Personal's private records, or, with a
 * `groupId`, that couple/home group's records, which live only on the partners' phones
 * (end to end encrypted, `e2ee/`): written here first, then sent to the partner.
 * Both hold the same record shapes, so everything above this decodes them alike.
 */
export function useRentalStore(groupId?: string): RentalStore {
  const personal = usePersonalRecords();
  const group = useGroupRecords(groupId);
  const upsertPersonal = useUpsertPersonalRecord();
  const delPersonal = useDeletePersonalRecord();
  const memberId = useMyMemberId(groupId);
  const me = async () => {
    if (!groupId || !memberId) throw new Error('This space is not ready yet');
    return { memberId, clockId: await clockId(memberId) };
  };
  const upsertGroup = useMutation({
    mutationFn: async (input: {
      recordId: string;
      recordKind: string;
      data: Record<string, unknown>;
    }) => e2eeSpace.upsert(groupId ?? '', await me(), input.recordId, input.recordKind, input.data),
  });
  const delGroup = useMutation({
    mutationFn: async (recordId: string) => e2eeSpace.del(groupId ?? '', await me(), recordId),
  });
  const records = selectRentalRecords<RentalRecord>(groupId, personal, group);
  return useMemo(
    () =>
      groupId
        ? {
            records,
            upsert: (recordId, recordKind, data) =>
              upsertGroup.mutateAsync({ recordId, recordKind, data }),
            del: (recordId) => delGroup.mutateAsync(recordId),
            isPending: upsertGroup.isPending,
          }
        : {
            records,
            upsert: (recordId, recordKind, data) =>
              upsertPersonal.mutateAsync({ recordId, recordKind, data }),
            del: (recordId) => delPersonal.mutateAsync(recordId),
            isPending: upsertPersonal.isPending,
          },
    [groupId, records, upsertGroup, delGroup, upsertPersonal, delPersonal],
  );
}

/** The signed-in person's member id in a group (null for Personal, or before the group has synced). */
export function useMyMemberId(groupId?: string): string | null {
  const viewerId = useViewerId();
  const { members: membersRead } = useGroup(groupId ?? '');
  const rows = membersRead.data;
  return useMemo(
    () => (groupId ? myMemberIdFrom(rows, viewerId) : null),
    [groupId, rows, viewerId],
  );
}

/** Active properties this person added in this space: what their own plan's free cap counts. */
export function useOwnPropertyCount(groupId?: string): number {
  const { records } = useRentalStore(groupId);
  const me = useMyMemberId(groupId);
  return ownActiveProperties(records, me);
}

/** The group's name, shown under the header in a group space. */
export function useSpaceName(groupId?: string): string | undefined {
  const former = isFormer(groupId ?? '');
  const { group } = useGroup(former ? '' : (groupId ?? ''));
  const { t } = useStrings();
  const formerName = useFormerCouples().find((f) => f.groupId === groupId)?.name;
  if (former) return fill(t.wealth.formerCouple, { name: formerName ?? '' });
  return groupId ? (group.data?.name ?? undefined) : undefined;
}

export function useSpaceType(groupId?: string): string | undefined {
  const { group } = useGroup(isFormer(groupId ?? '') ? '' : (groupId ?? ''));
  return groupId ? group.data?.type : undefined;
}

export function usePersonalWealth(groupId?: string): PersonalWealth {
  const { records } = useRentalStore(groupId);
  return useMemo(() => decodeWealth(records), [records]);
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

export function useWealthWrites(groupId?: string) {
  const store = useRentalStore(groupId);
  const { records } = store;
  const myMemberId = useMyMemberId(groupId);
  const { isPro } = useEntitlement();
  const put = (
    recordKind: Parameters<RentalStore['upsert']>[1],
    recordId: string,
    data: Record<string, unknown>,
  ) => store.upsert(recordId, recordKind, data);

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

  /** The tenancy and its rent rule, exactly as the add flow writes them. */
  const putTenancy = async (
    propertyId: string,
    propertyName: string,
    currency: CurrencyCode,
    t: NonNullable<RentalDraft['tenant']>,
    today: string,
  ): Promise<void> => {
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
      currency,
      frequency: t.frequency,
      anchor: rentAnchor(t.startDate, t.day, today, t.frequency),
      note: `Rent · ${propertyName}`,
    });
    await put('recurring', rid, data);
  };

  return {
    isPending: store.isPending,

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

    saveProperty: (prop: PersonalProperty) => {
      const { id, ...rest } = prop;
      return put('property', id, encodeProperty(rest));
    },

    saveTenancy: (tn: PersonalTenancy) => {
      const { id, ...rest } = tn;
      return put('tenancy', id, encodeTenancy(rest));
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

    /** A new tenant on a vacant property. */
    addTenant: (property: PersonalProperty, t: NonNullable<RentalDraft['tenant']>, today: string) =>
      putTenancy(property.id, property.name, property.currency, t, today),

    async createRental(d: RentalDraft): Promise<string> {
      // Each partner's cap is their own plan's: only properties this person added count.
      const count = ownActiveProperties(records, myMemberId);
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
            address: null,
            currency: d.currency,
            status: 'active',
            note: null,
          }),
        );
        if (d.tenant) await putTenancy(propertyId, d.name, d.currency, d.tenant, d.today);
        return propertyId;
      } finally {
        pendingProperties -= 1;
      }
    },

    /**
     * Each payment is its own entry with a fresh id, so part payments never overwrite one
     * another. `fullDue` marks a full payment of an untouched due date: in a group space that
     * one keeps a fixed id, so two partners tapping "paid in full" write one record.
     */
    recordRent: (
      rule: PersonalRecurring,
      propertyId: string,
      amount: bigint,
      date: string,
      label: string,
      fullDue: { date: string; ruleId: string } | null = null,
    ) =>
      put(
        'txn',
        rentEntryId(!!groupId, fullDue?.ruleId ?? rule.id, fullDue?.date ?? null, randomUUID),
        encodeTxn({
          kind: 'income',
          amount,
          currency: rule.currency,
          category: 'inc.rent',
          // A generic note: the tenant's name never goes into an entry.
          note: `Rent · ${label}`,
          date,
          loanId: null,
          recurringId: fullDue?.ruleId ?? rule.id,
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

    /**
     * A rent raise: start the new rule, then end the old one the day before, so a
     * failure between the two never leaves the tenant with no rule. The new rule's
     * id comes from tenancy + start date, so repeating the call upserts the same
     * rule. `raiseFor` marks it as the answer to a yearly-increase anniversary.
     */
    async changeRent(
      old: PersonalRecurring,
      newAmount: bigint,
      from: string,
      raiseFor?: string,
    ): Promise<void> {
      const { due, oldEnd } = rentRaiseDates(old, from);
      const { id, ...rest } = old;
      await put(
        'recurring',
        raiseRuleId(old.tenancyId ?? null, due) ?? randomUUID(),
        encodeRecurring({
          ...rest,
          carried: raiseFor ? { raiseFor } : undefined,
          amount: newAmount,
          anchorDate: due,
          nextDate: due,
          endDate: null,
        }),
      );
      await put(
        'recurring',
        id,
        encodeRecurring({
          ...rest,
          active: oldEnd >= todayIso() ? rest.active : false,
          endDate: oldEnd,
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
      await store.del(id);
    },

    deleteRecord: (id: string) => store.del(id),
  };
}
