/** The add-investment form as pure logic: what shows, what is required, and the draft it saves. */
import {
  INVESTMENT_TYPES,
  type CurrencyCode,
  type InvestmentType,
  type RentFrequency,
} from '@waves/core';

import type { InvestmentDraft } from '@/data/personalWealth';

export const FREE_INVESTMENT_CAP = 3;
export const MATURES: readonly InvestmentType[] = [
  'deposit',
  'bonds',
  'insurance_linked',
  'savings_group',
];
export const WITH_WRAPPER: readonly InvestmentType[] = ['retirement', 'deposit', 'fund', 'bonds'];

export interface InvestmentForm {
  type: InvestmentType;
  /** Only asked for insurance: does money come back at the end? */
  payout: 'yes' | 'no';
  name: string;
  amount: bigint;
  frequency: RentFrequency;
  day: number;
  startDate: string | null;
  auto: 'yes' | 'no';
  opening: bigint;
  value: bigint;
  wrapper: boolean;
  maturityDate: string | null;
}

export const investmentFormStart = (today: string): InvestmentForm => ({
  type: INVESTMENT_TYPES[0]!,
  payout: 'yes',
  name: '',
  amount: 0n,
  frequency: 'monthly',
  day: 1,
  startDate: today,
  auto: 'no',
  opening: 0n,
  value: 0n,
  wrapper: false,
  maturityDate: null,
});

const isPlain = (f: InvestmentForm): boolean => f.type === 'insurance_linked' && f.payout === 'no';
const isWeekly = (f: InvestmentForm): boolean =>
  f.frequency === 'weekly' || f.frequency === 'fortnightly';

export function investmentFormShows(f: InvestmentForm) {
  const scheduled = f.amount > 0n;
  const holding = !isPlain(f);
  return {
    payout: f.type === 'insurance_linked',
    auto: scheduled,
    day: scheduled && !isWeekly(f),
    startDate: scheduled && isWeekly(f),
    opening: holding,
    value: holding,
    wrapper: holding && WITH_WRAPPER.includes(f.type),
    maturity: holding && MATURES.includes(f.type),
  };
}

/** A name, and something to track: a recurring amount, or (for a holding) money already in. */
export const investmentFormReady = (f: InvestmentForm): boolean =>
  f.name.trim() !== '' && (f.amount > 0n || (!isPlain(f) && (f.opening > 0n || f.value > 0n)));

export function buildInvestmentDraft(
  f: InvestmentForm,
  ctx: { currency: CurrencyCode; today: string; fallbackName: string },
): { draft: InvestmentDraft; plain: boolean } {
  const show = investmentFormShows(f);
  return {
    plain: isPlain(f),
    draft: {
      type: f.type,
      name: f.name.trim() || ctx.fallbackName,
      currency: ctx.currency,
      amount: f.amount,
      frequency: f.frequency,
      day: show.day ? f.day : 1,
      autoPost: show.auto && f.auto === 'yes',
      openingInvested: show.opening ? f.opening : 0n,
      currentValue: show.value && f.value > 0n ? f.value : null,
      taxWrapper: show.wrapper && f.wrapper,
      maturityDate: show.maturity ? f.maturityDate : null,
      startDate: show.startDate ? f.startDate : null,
      today: ctx.today,
    },
  };
}

/** Free users may hold three active investments; a plain insurance bill is not one. */
export const overFreeCap = (plain: boolean, isPro: boolean, activeCount: number): boolean =>
  !plain && !isPro && activeCount >= FREE_INVESTMENT_CAP;
