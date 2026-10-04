/**
 * The demo trip is meant to look like a real one, which means its numbers
 * have to be real too: every expense's payers and shares have to sum to its
 * own amount, and the balances `@waves/core` computes from them have to come
 * out the way a person skimming the group would expect — the person who paid
 * for everyone is owed, the one foreign-currency buy only touches the two
 * people on it, and the one settlement actually reduces what it was paying
 * down.
 *
 * Deliberately not exercised through `@/data/hooks` (`useGroup`,
 * `useHomeSummary`, …): those are React hooks wired to `useSync()`, and this
 * suite is about the arithmetic underneath them, the same split between
 * "pure module" and "renders" every other test file in this project draws.
 */
import { describe, expect, it } from 'vitest';

import { computeNetBalances, computePairwiseBalances } from '@waves/core';
import type { ExpenseSnapshot, SettlementSnapshot } from '@waves/core';

import {
  demoExpenses,
  demoGroupRow,
  demoMembers,
  demoSettlements,
} from '@/demo/fixtures';
import {
  DEMO_MEMBER_ALEX_ID,
  DEMO_MEMBER_ME_ID,
  DEMO_MEMBER_PRIYA_ID,
  DEMO_MEMBER_SAM_ID,
} from '@/demo/ids';
import { isGhost, type ExpenseRow, type SettlementRow } from '@/data/types';

const VIEWER = 'viewer-profile-id';

/** The same conversion `@/data/hooks`' `toSnapshot` does — kept local so
 *  this suite never has to import a React hooks module to test arithmetic. */
function snapshotOf(expense: ExpenseRow): ExpenseSnapshot {
  const version = expense.currentVersion!;
  return {
    id: expense.id,
    currency: version.currency,
    amount: BigInt(version.amount),
    payers: Object.fromEntries(version.payers.map((p) => [p.member_id, BigInt(p.amount)])),
    shares: Object.fromEntries(version.shares.map((s) => [s.member_id, BigInt(s.amount)])),
    date: version.expense_date,
    deletedAt: expense.deleted_at,
  };
}

function settlementSnapshotOf(row: SettlementRow): SettlementSnapshot {
  return {
    id: row.id,
    from: row.from_member_id,
    to: row.to_member_id,
    currency: row.currency,
    amount: BigInt(row.amount),
    status: row.status,
    at: row.initiated_at,
  };
}

describe('the demo fixture', () => {
  it('names the viewer inside their own demo trip', () => {
    const members = demoMembers(VIEWER);
    const me = members.find((m) => m.id === DEMO_MEMBER_ME_ID);
    expect(me?.profile_id).toBe(VIEWER);
    // The three friends are plain ghosts — ordinary, not a special case.
    expect(members.filter((m) => isGhost(m))).toHaveLength(3);
  });

  it('sums every expense\'s payers and shares to its own amount', () => {
    for (const expense of demoExpenses()) {
      const version = expense.currentVersion!;
      const amount = BigInt(version.amount);
      const paid = version.payers.reduce((sum, p) => sum + BigInt(p.amount), 0n);
      const owed = version.shares.reduce((sum, s) => sum + BigInt(s.amount), 0n);
      expect(paid).toBe(amount);
      expect(owed).toBe(amount);
    }
  });

  it('covers every split kind the spec asked for, plus a multi-payer expense and a foreign currency', () => {
    const kinds = new Set(demoExpenses().map((e) => e.currentVersion!.split_type));
    expect(kinds).toEqual(new Set(['exact', 'equal', 'percent', 'shares']));

    const multiPayer = demoExpenses().find((e) => e.currentVersion!.payers.length > 1);
    expect(multiPayer).toBeDefined();

    const foreign = demoExpenses().find((e) => e.currentVersion!.currency !== 'INR');
    expect(foreign?.currentVersion?.currency).toBe('USD');
    expect(foreign?.currentVersion?.fx).not.toBeNull();

    const receipted = demoExpenses().find((e) => Boolean(e.currentVersion?.notes));
    expect(receipted?.currentVersion?.notes).toMatch(/Grilled fish/);
  });

  it("computes a net balance for every member, and the group as a whole clears to zero", () => {
    const snapshots = demoExpenses().map(snapshotOf);
    const settlementSnapshots = demoSettlements().map(settlementSnapshotOf);
    const group = demoGroupRow();

    const net = computeNetBalances(snapshots, settlementSnapshots);
    const perMember = net.get(group.default_currency);
    expect(perMember).toBeDefined();

    // Every member the fixture names shows up with a balance — nobody drops
    // out silently, which is the failure mode that would make the group
    // screen render fewer people than the roster it just showed.
    for (const id of [
      DEMO_MEMBER_ME_ID,
      DEMO_MEMBER_PRIYA_ID,
      DEMO_MEMBER_ALEX_ID,
      DEMO_MEMBER_SAM_ID,
    ]) {
      expect(perMember?.has(id)).toBe(true);
    }

    // The ledger is append-only and every expense is accounted for on both
    // sides, so the four balances must sum to zero — the same invariant a
    // real group's ledger holds.
    let total = 0n;
    for (const balance of perMember!.values()) total += balance;
    expect(total).toBe(0n);
  });

  it('settles part of a real debt rather than floating free of the expenses', () => {
    const snapshots = demoExpenses().map(snapshotOf);
    const withoutSettlement = computeNetBalances(snapshots, []);
    const withSettlement = computeNetBalances(snapshots, demoSettlements().map(settlementSnapshotOf));

    const currency = demoGroupRow().default_currency;
    const alexBefore = withoutSettlement.get(currency)?.get(DEMO_MEMBER_ALEX_ID) ?? 0n;
    const alexAfter = withSettlement.get(currency)?.get(DEMO_MEMBER_ALEX_ID) ?? 0n;

    // Alex pays ₹1500 towards Alex's own debt: Alex's balance must move
    // towards zero by exactly that much, not drift by some other amount and
    // not move the wrong way.
    expect(alexAfter - alexBefore).toBe(150_000n);
  });

  it('keeps the USD expense off the two people who did not buy anything', () => {
    const snapshots = demoExpenses().map(snapshotOf);
    const pairwise = computePairwiseBalances(snapshots, []);
    // Nobody is on an edge in USD except the two who are actually in its
    // shares/payers — Alex and Sam never touched the duty-free buy.
    const usdEdges = pairwise.filter((edge) => edge.currency === 'USD');
    const touchesAlexOrSam = usdEdges.some(
      (edge) => edge.from === DEMO_MEMBER_ALEX_ID || edge.to === DEMO_MEMBER_ALEX_ID ||
        edge.from === DEMO_MEMBER_SAM_ID || edge.to === DEMO_MEMBER_SAM_ID,
    );
    expect(touchesAlexOrSam).toBe(false);
  });
});
