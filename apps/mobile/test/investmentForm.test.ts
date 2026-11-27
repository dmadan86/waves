import { describe, expect, it } from 'vitest';

import {
  FREE_INVESTMENT_CAP,
  buildInvestmentDraft,
  investmentFormReady,
  investmentFormShows,
  investmentFormStart,
  overFreeCap,
  type InvestmentForm,
} from '../src/lib/investmentForm';

const ctx = { currency: 'INR' as const, today: '2026-11-27', fallbackName: 'Fund' };
const form = (p: Partial<InvestmentForm> = {}): InvestmentForm => ({
  ...investmentFormStart('2026-11-27'),
  ...p,
});

describe('investment form', () => {
  it('needs only a name and an amount to save', () => {
    expect(investmentFormReady(form())).toBe(false);
    expect(investmentFormReady(form({ name: 'SIP' }))).toBe(false);
    expect(investmentFormReady(form({ name: 'SIP', amount: 500n }))).toBe(true);
    expect(investmentFormReady(form({ name: ' ', amount: 500n }))).toBe(false);
  });

  it('a one-off holding with only money already in is fine', () => {
    expect(investmentFormReady(form({ name: 'Gold', opening: 100n }))).toBe(true);
  });

  it('a bill-only insurance needs a recurring amount', () => {
    const f = form({ type: 'insurance_linked', payout: 'no', name: 'LIC', opening: 100n });
    expect(investmentFormReady(f)).toBe(false);
    expect(investmentFormReady({ ...f, amount: 100n })).toBe(true);
  });

  it('shows fields only when relevant', () => {
    expect(investmentFormShows(form()).payout).toBe(false);
    expect(investmentFormShows(form({ type: 'insurance_linked' })).payout).toBe(true);
    const none = investmentFormShows(form());
    expect(none.auto).toBe(false);
    expect(none.day).toBe(false);
    const sched = investmentFormShows(form({ amount: 10n }));
    expect(sched.auto && sched.day && !sched.startDate).toBe(true);
    expect(investmentFormShows(form({ amount: 10n, frequency: 'weekly' })).startDate).toBe(true);
    expect(investmentFormShows(form({ type: 'deposit' })).maturity).toBe(true);
    expect(investmentFormShows(form({ type: 'stocks' })).maturity).toBe(false);
    expect(investmentFormShows(form({ type: 'fund' })).wrapper).toBe(true);
    expect(investmentFormShows(form({ type: 'insurance_linked', payout: 'no' })).opening).toBe(
      false,
    );
  });

  it('keeps amounts as bigint minor units and trims the name', () => {
    const { draft, plain } = buildInvestmentDraft(
      form({ name: '  SIP ', amount: 250000n, opening: 5n, value: 9n, auto: 'yes' }),
      ctx,
    );
    expect(plain).toBe(false);
    expect(draft).toMatchObject({
      name: 'SIP',
      amount: 250000n,
      openingInvested: 5n,
      currentValue: 9n,
      autoPost: true,
      currency: 'INR',
    });
  });

  it('falls back to the type name and nulls a zero value', () => {
    const { draft } = buildInvestmentDraft(form({ amount: 1n }), ctx);
    expect(draft.name).toBe('Fund');
    expect(draft.currentValue).toBeNull();
  });

  it('clears fields that are hidden', () => {
    const { draft } = buildInvestmentDraft(
      form({
        type: 'stocks',
        name: 'x',
        amount: 0n,
        auto: 'yes',
        day: 15,
        wrapper: true,
        maturityDate: '2030-01-01',
        startDate: '2026-12-01',
        frequency: 'weekly',
      }),
      ctx,
    );
    expect(draft).toMatchObject({
      autoPost: false,
      day: 1,
      taxWrapper: false,
      maturityDate: null,
      startDate: null,
    });
    const monthly = buildInvestmentDraft(form({ amount: 5n, startDate: '2026-12-01' }), ctx);
    expect(monthly.draft.startDate).toBeNull();
    const weekly = buildInvestmentDraft(
      form({ amount: 5n, frequency: 'weekly', startDate: '2026-12-01' }),
      ctx,
    );
    expect(weekly.draft.startDate).toBe('2026-12-01');
  });

  it('a plain bill drops the holding fields', () => {
    const { draft, plain } = buildInvestmentDraft(
      form({
        type: 'insurance_linked',
        payout: 'no',
        name: 'LIC',
        amount: 9n,
        opening: 7n,
        value: 8n,
        maturityDate: '2030-01-01',
      }),
      ctx,
    );
    expect(plain).toBe(true);
    expect(draft).toMatchObject({
      openingInvested: 0n,
      currentValue: null,
      maturityDate: null,
      taxWrapper: false,
    });
  });

  it('sends free users past the cap to the paywall, but never a plain bill', () => {
    expect(overFreeCap(false, false, FREE_INVESTMENT_CAP)).toBe(true);
    expect(overFreeCap(false, false, FREE_INVESTMENT_CAP - 1)).toBe(false);
    expect(overFreeCap(false, true, 99)).toBe(false);
    expect(overFreeCap(true, false, 99)).toBe(false);
  });
});
