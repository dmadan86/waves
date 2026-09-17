/**
 * Who may answer a settlement, and when.
 *
 * These are consequential buttons: one of them contradicts a person, another
 * takes back a claim about money. The cases below are the ones where showing
 * the wrong thing matters — the payer offered the payee's answer, a settled
 * claim still offering answers, and the auto-confirmed state, where a
 * settlement nobody actively agreed to has to stay disputable.
 */

import { describe, expect, it } from 'vitest';

import { openSettlements, settlementActions } from '../src/lib/settlementActions';

const PAYER = 'payer-member-id';
const PAYEE = 'payee-member-id';
const BYSTANDER = 'someone-else';

const at = (status: string) => ({
  status,
  from_member_id: PAYER,
  to_member_id: PAYEE,
});

describe('settlementActions', () => {
  it('offers the payee both answers while a claim is waiting', () => {
    const actions = settlementActions(at('initiated'), PAYEE);
    expect(actions.canConfirm).toBe(true);
    expect(actions.canDispute).toBe(true);
    // Confirming is the payee's to do, not the payer's.
    expect(actions.canWithdraw).toBe(false);
  });

  it('offers the payer only the withdrawal', () => {
    const actions = settlementActions(at('initiated'), PAYER);
    expect(actions).toMatchObject({ canConfirm: false, canDispute: false, canWithdraw: true });
  });

  it('offers a bystander nothing', () => {
    expect(settlementActions(at('initiated'), BYSTANDER)).toMatchObject({
      canConfirm: false,
      canDispute: false,
      canWithdraw: false,
    });
    expect(settlementActions(at('initiated'), null)).toMatchObject({
      canConfirm: false,
      canDispute: false,
      canWithdraw: false,
    });
  });

  it('keeps an auto-confirmed settlement disputable by its payee', () => {
    // The state exists for a claim nobody answered in time. Treating it as
    // finished leaves exactly the settlements nobody agreed to with no way to
    // say so.
    const actions = settlementActions(at('auto_confirmed'), PAYEE);
    expect(actions.canDispute).toBe(true);
    expect(actions.canConfirm).toBe(false);
    expect(actions.isOpen).toBe(true);
    // The payer cannot take back one that has already gone through.
    expect(settlementActions(at('auto_confirmed'), PAYER).canWithdraw).toBe(false);
  });

  it('lets a disputed settlement be confirmed after all', () => {
    const actions = settlementActions(at('disputed'), PAYEE);
    expect(actions.canConfirm).toBe(true);
    expect(settlementActions(at('disputed'), PAYER).canWithdraw).toBe(true);
  });

  it('offers nothing once a settlement is finished', () => {
    for (const status of ['confirmed', 'cancelled']) {
      expect(settlementActions(at(status), PAYEE)).toMatchObject({
        canConfirm: false,
        canDispute: false,
        isOpen: false,
      });
      expect(settlementActions(at(status), PAYER).canWithdraw).toBe(false);
    }
  });

  it('offers nothing for a status it has never heard of', () => {
    // A state added server-side should show no buttons here rather than
    // guessing which ones apply.
    expect(settlementActions(at('refunded'), PAYEE)).toMatchObject({
      canConfirm: false,
      canDispute: false,
      canWithdraw: false,
      isOpen: false,
    });
  });
});

describe('openSettlements', () => {
  it('keeps what is still answerable and drops what is history', () => {
    const rows = [
      at('initiated'),
      at('auto_confirmed'),
      at('disputed'),
      at('confirmed'),
      at('cancelled'),
    ];
    expect(openSettlements(rows).map((row) => row.status)).toEqual([
      'initiated',
      'auto_confirmed',
      'disputed',
    ]);
  });
});
