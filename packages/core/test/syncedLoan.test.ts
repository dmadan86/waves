/**
 * Synced 1:1 loans (LG-* for the shared case). "Ravi owes me ₹5,000" is a
 * personal loan AND one expense in a 1:1 group; these pin the pure maths that
 * joins the two without ever counting the money twice.
 */

import { describe, expect, it } from 'vitest';

import {
  budgetSpendWindow,
  canUnlink,
  cleanCounterpart,
  computeNetBalances,
  computePairwiseBalances,
  computePersonalSpending,
  computeShares,
  decodeLoan,
  encodeLoan,
  loanOutstanding,
  loanTotals,
  pairBalances,
  planLendUndo,
  reusableLink,
  sameCurrency,
  shareBlocker,
  syncedExpenseIds,
  syncedLoanExpense,
  syncedOutstanding,
  withoutLink,
  type ExpenseSnapshot,
  type PersonalLoan,
  type PersonalTxn,
  type SettlementSnapshot,
  type SyncedLoanLink,
} from '../src/index.js';

const ME = 'm-me';
const RAVI = 'm-ravi';
const link = (over: Partial<SyncedLoanLink> = {}): SyncedLoanLink => ({
  groupId: 'g1',
  expenseId: 'e1',
  myMemberId: ME,
  otherMemberId: RAVI,
  ...over,
});
const loan = (over: Partial<PersonalLoan> = {}): PersonalLoan => ({
  id: 'L1',
  direction: 'lent',
  counterpart: 'Ravi',
  principal: 800000n,
  currency: 'INR',
  note: null,
  startDate: '2026-10-01',
  status: 'active',
  synced: link(),
  ...over,
});
const txn = (over: Partial<PersonalTxn> = {}): PersonalTxn => ({
  id: 't1',
  kind: 'expense',
  amount: 800000n,
  currency: 'INR',
  category: 'food',
  note: null,
  date: '2026-10-01',
  loanId: null,
  recurringId: null,
  ...over,
});

/** The group ledger for a loan expense, through the real balance code. */
function ledger(l: PersonalLoan, settlements: SettlementSnapshot[] = []) {
  const e = syncedLoanExpense({
    direction: l.direction,
    amount: l.principal,
    currency: l.currency,
    date: l.startDate,
    myMemberId: ME,
    otherMemberId: RAVI,
    note: l.note,
    counterpart: l.counterpart,
  });
  const shares = computeShares({
    amount: e.amount,
    currency: e.currency,
    params: e.splitParams,
    participants: e.participants,
    seed: 'e1',
  });
  const snap: ExpenseSnapshot = {
    id: 'e1',
    currency: e.currency,
    amount: e.amount,
    payers: e.payers,
    shares: Object.fromEntries(shares),
    date: e.expenseDate,
  };
  return { e, snap, settlements };
}

function netFor(l: PersonalLoan, settlements: SettlementSnapshot[] = []) {
  const { snap } = ledger(l, settlements);
  const edges = computePairwiseBalances([snap], settlements);
  const pair = pairBalances([
    {
      groupId: 'g1',
      simplify: false,
      viewerMemberId: ME,
      otherMemberIds: [RAVI],
      edges,
      suggested: null,
    },
  ]);
  const net = pair.totals.find((total) => total.currency === l.currency)?.net ?? 0n;
  return new Map([['g1', new Map([[l.currency, net]])]]);
}

const repay = (amount: bigint, from = RAVI, to = ME): SettlementSnapshot => ({
  id: `s${amount}`,
  from,
  to,
  currency: 'INR',
  amount,
  status: 'confirmed' as SettlementSnapshot['status'],
  at: '2026-10-05T00:00:00Z',
});

describe('LG synced loan', () => {
  it('LG-01 lending books Ravi as owing me the whole amount and removes my personal spend', () => {
    const l = loan();
    const { e } = ledger(l);
    expect(e.payers).toEqual({ [ME]: 800000n });
    expect(e.splitParams.amounts).toEqual({ [RAVI]: 800000n, [ME]: 0n });
    expect(netFor(l).get('g1')?.get('INR')).toBe(800000n);
    // The personal txn is deleted, so the month's spending is just what is left.
    const rest = [txn({ id: 'other', amount: 20000n })];
    expect(computePersonalSpending(rest, '2026-10', 'INR').spending).toBe(20000n);
  });

  it('LG-02 a gift is not a loan: nothing shared, txn stays in spending', () => {
    const gift = [txn()];
    expect(computePersonalSpending(gift, '2026-10', 'INR').spending).toBe(800000n);
    expect(syncedExpenseIds([])).toEqual(new Set());
  });

  it('LG-03 outstanding is principal minus repayments, read from the group balance', () => {
    const l = loan();
    const left = syncedOutstanding([l], netFor(l, [repay(300000n)]));
    expect(left.get('L1')).toBe(500000n);
  });

  it('LG-04 overpayment leaves zero, never negative', () => {
    const l = loan();
    const left = syncedOutstanding([l], netFor(l, [repay(900000n)]));
    expect(left.get('L1')).toBe(0n);
    expect(loanTotals([l], left)).toEqual([]);
  });

  it('LG-05 a repayment in another currency is kept apart', () => {
    const l = loan();
    const nets = new Map([['g1', new Map([['USD', 5000n]])]]);
    expect(syncedOutstanding([l], nets).get('L1')).toBe(0n);
    expect(sameCurrency(l, 'USD')).toBe(false);
    expect(sameCurrency(l, 'INR')).toBe(true);
  });

  it('LG-06 two loans to Ravi list separately; repayments clear the oldest first; totals sum', () => {
    const a = loan({ id: 'A', principal: 300000n, startDate: '2026-09-01' });
    const b = loan({
      id: 'B',
      principal: 500000n,
      startDate: '2026-10-01',
      synced: link({ expenseId: 'e2' }),
    });
    const nets = new Map([['g1', new Map([['INR', 600000n]])]]);
    const left = syncedOutstanding([a, b], nets);
    expect((left.get('A') ?? 0n) + (left.get('B') ?? 0n)).toBe(600000n);
    expect(left.get('B')).toBe(500000n);
    expect(left.get('A')).toBe(100000n);
    expect(loanTotals([a, b], left)).toEqual([
      { currency: 'INR', direction: 'lent', amount: 600000n },
    ]);
  });

  it('LG-07 the personal loan never reaches a budget, and the group expense is recognisable', () => {
    const repaid = txn({ loanId: 'L1', amount: 100000n });
    const w = budgetSpendWindow([repaid], { category: null, currency: 'INR' }, '2026-10');
    expect(w.total).toBe(0n);
    expect(syncedExpenseIds([loan()]).has('e1')).toBe(true);
    expect(syncedExpenseIds([loan({ synced: null })]).size).toBe(0);
  });

  it('LG-08 borrowed: Anu paid, my share is the lot, I owe her', () => {
    const l = loan({ direction: 'borrowed', counterpart: 'Anu', principal: 200000n });
    const { e } = ledger(l);
    expect(e.payers).toEqual({ [RAVI]: 200000n });
    expect(e.splitParams.amounts).toEqual({ [ME]: 200000n, [RAVI]: 0n });
    const nets = netFor(l);
    expect(nets.get('g1')?.get('INR')).toBe(-200000n);
    expect(syncedOutstanding([l], nets).get('L1')).toBe(200000n);
  });

  it('LG-09 counterpart is trimmed, capitalised and capped at 60', () => {
    expect(cleanCounterpart('  ravi   kumar ')).toBe('Ravi Kumar');
    expect(cleanCounterpart("d'souza mcDonald")).toBe("D'souza McDonald");
    expect(Array.from(cleanCounterpart('a'.repeat(90))).length).toBe(60);
    expect(cleanCounterpart('   ')).toBe('');
  });

  it('LG-10 undo of a shared lend deletes the loan and the group expense and restores the txn as it was', () => {
    const original = txn({ carried: { place: 'x' } });
    const plan = planLendUndo(loan(), original);
    expect(plan.deleteLoanId).toBe('L1');
    expect(plan.deleteGroupExpense).toEqual({ groupId: 'g1', expenseId: 'e1' });
    expect(plan.restoreTxn).toBe(original);
    expect(planLendUndo(loan({ synced: null }), original).deleteGroupExpense).toBeNull();
  });

  it('LG-11 the link round-trips through the blob and unknown fields survive', () => {
    const encoded = encodeLoan({ ...loan(), carried: { future: 1 } });
    const back = decodeLoan('L1', encoded);
    expect(back.synced).toEqual(link());
    expect(back.carried).toEqual({ future: 1 });
    // A half link is no link, but is not lost either.
    const odd = decodeLoan('L2', { ...encoded, synced: { groupId: 'g' } });
    expect(odd.synced).toBeNull();
    expect(encodeLoan(odd).synced).toEqual({ groupId: 'g' });
    // A private loan writes no `synced` key.
    expect('synced' in encodeLoan(withoutLink(loan()))).toBe(false);
  });

  it('LG-12 a loan cannot be shared twice, or without a name or amount', () => {
    expect(shareBlocker(loan())).toBe('already');
    expect(shareBlocker(loan({ synced: null, counterpart: ' ' }))).toBe('no-name');
    expect(shareBlocker(loan({ synced: null, principal: 0n }))).toBe('no-amount');
    expect(shareBlocker(loan({ synced: null, status: 'closed' }))).toBe('closed');
    expect(shareBlocker(loan({ synced: null }))).toBeNull();
  });

  it('LG-13 equal-split payer switch keeps shares: me -400, Ravi +800 for 1200 across 3', () => {
    const shares = computeShares({
      amount: 120000n,
      currency: 'INR',
      params: { kind: 'equal' },
      participants: [ME, RAVI, 'm-c'],
      seed: 'x',
    });
    const snap: ExpenseSnapshot = {
      id: 'x',
      currency: 'INR',
      amount: 120000n,
      payers: { [RAVI]: 120000n },
      shares: Object.fromEntries(shares),
      date: '2026-10-01',
    };
    const net = computeNetBalances([snap], []).get('INR');
    expect(net?.get(ME)).toBe(-40000n);
    expect(net?.get(RAVI)).toBe(80000n);
  });

  it('LG-14 balances over the loan expense sum to zero', () => {
    const { snap } = ledger(loan());
    const net = computeNetBalances([snap], []).get('INR');
    expect([...(net?.values() ?? [])].reduce((a, b) => a + b, 0n)).toBe(0n);
  });

  it('LG-15 the shared loan appears once in the pair balance (no double count)', () => {
    const l = loan();
    const { snap } = ledger(l);
    const edges = computePairwiseBalances([snap], []);
    const pair = pairBalances([
      {
        groupId: 'g1',
        simplify: true,
        viewerMemberId: ME,
        otherMemberIds: [RAVI],
        edges,
        suggested: null,
      },
    ]);
    expect(pair.totals).toEqual([{ currency: 'INR', net: 800000n }]);
    // Personal side: no repayment txns, so the personal outstanding is untouched.
    expect(loanOutstanding(l, [])).toBe(800000n);
  });

  it('LG-16 a full settlement closes the debt; a second loan reuses the same 1:1 group', () => {
    const l = loan();
    expect(syncedOutstanding([l], netFor(l, [repay(800000n)])).get('L1')).toBe(0n);
    expect(reusableLink([l], ' ravi ', 'INR', () => true)).toEqual(link());
    expect(reusableLink([l], 'Ravi', 'USD', () => true)).toBeNull();
    expect(reusableLink([l], 'Ravi', 'INR', () => false)).toBeNull();
    expect(reusableLink([l], 'Sam', 'INR', () => true)).toBeNull();
  });

  it('LG-17 unlink is allowed only while nothing has been repaid', () => {
    const l = loan();
    expect(canUnlink(l, new Map([['L1', 800000n]]))).toBe(true);
    expect(canUnlink(l, new Map([['L1', 500000n]]))).toBe(false);
    expect(canUnlink(loan({ synced: null }), new Map())).toBe(false);
  });
});
