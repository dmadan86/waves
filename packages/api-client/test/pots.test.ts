import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createWavesClient, WavesApiError } from '../src/client';
import { toExpenseSnapshot, toSettlementSnapshot } from '../src/ledger';

function fixture() {
  const rpc = vi.fn().mockResolvedValue({ data: 'id', error: null });
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  const from = vi.fn(() => query);
  return {
    rpc,
    from,
    query,
    api: createWavesClient({ supabase: { rpc, from } as unknown as SupabaseClient }),
  };
}
const payment = {
  potId: 'pot',
  fromMemberId: 'member',
  toMemberId: 'treasurer',
  amount: 9007199254740993n,
  clientMutationId: 'stable',
};

describe('pot API', () => {
  it('creates with decimal money and caller-owned retry identity', async () => {
    const { rpc, api } = fixture();
    const input = {
      groupId: 'group',
      name: 'Lunch',
      currency: 'INR',
      perHeadMinor: 10000n,
      treasurerMemberId: 'treasurer',
      clientMutationId: 'stable',
    };
    await api.createPot(input);
    await api.createPot(input);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc).toHaveBeenCalledWith('waves_create_pot', {
      p_group_id: 'group',
      p_name: 'Lunch',
      p_currency: 'INR',
      p_per_head_minor: '10000',
      p_treasurer_member_id: 'treasurer',
      p_client_mutation_id: 'stable',
    });
  });
  it.each(['self', 'intent', 'sms', 'statement'] as const)(
    'records %s references without confirming',
    async (referenceSource) => {
      const { rpc, api } = fixture();
      await api.recordPotContribution({ ...payment, reference: '123456789012', referenceSource });
      expect(rpc).toHaveBeenCalledExactlyOnceWith('waves_record_pot_settlement', {
        p_pot_id: 'pot',
        p_from_member_id: 'member',
        p_to_member_id: 'treasurer',
        p_amount: '9007199254740993',
        p_client_mutation_id: 'stable',
        p_reference: '123456789012',
        p_reference_source: referenceSource,
      });
    },
  );
  it('defaults to self-report and only confirms on an explicit tick', async () => {
    const { rpc, api } = fixture();
    await api.recordPotContribution(payment);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_reference_source: 'self', p_reference: null });
    await api.confirmPotContribution('existing');
    expect(rpc.mock.calls[1]).toEqual([
      'waves_confirm_settlement',
      { p_settlement_id: 'existing' },
    ]);
  });
  it('uses atomic lifecycle RPCs without moving ledger rows', async () => {
    const { rpc, api, from } = fixture();
    await api.closePot({ potId: 'pot', clientMutationId: 'close' });
    await api.carryPot({ potId: 'pot', groupId: 'group', name: 'Next', clientMutationId: 'carry' });
    expect(rpc.mock.calls).toEqual([
      ['waves_close_pot', { p_pot_id: 'pot', p_client_mutation_id: 'close' }],
      [
        'waves_carry_pot',
        { p_pot_id: 'pot', p_group_id: 'group', p_name: 'Next', p_client_mutation_id: 'carry' },
      ],
    ]);
    expect(from).not.toHaveBeenCalled();
  });
  it('reads pots and transfers in one group-scoped query', async () => {
    const { api, from, query } = fixture();
    expect(await api.listPots('group')).toEqual([]);
    expect(from).toHaveBeenCalledWith('pots');
    expect(query.eq).toHaveBeenCalledWith('group_id', 'group');
    expect(query.select.mock.calls[0]?.[0]).toContain('settlements!settlements_pot_id_fkey');
    expect(query.select.mock.calls[0]?.[0]).toContain('reference_source');
  });
  it('uses only restricted public RPCs for pay codes', async () => {
    const { api, rpc, from } = fixture();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await api.potPayLookup('code')).toBeNull();
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await api.potPaySelfReport('code', 'Ravi', '123456789012')).toBe(false);
    expect(rpc.mock.calls).toEqual([
      ['pot_pay_lookup', { code: 'code' }],
      ['pot_pay_self_report', { code: 'code', payer_name: 'Ravi', utr: '123456789012' }],
    ]);
    expect(from).not.toHaveBeenCalled();
  });
  it('propagates authorization failures', async () => {
    const { rpc, api, query } = fixture();
    rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN' } });
    await expect(api.confirmPotContribution('id')).rejects.toBeInstanceOf(WavesApiError);
    query.order.mockResolvedValue({ data: null, error: { message: 'read failed' } });
    await expect(api.listPots('group')).rejects.toThrow('read failed');
  });
});

describe('pot identity on ledger snapshots', () => {
  it('keeps links while adapting wire rows for the mobile partition helper', () => {
    const expense = toExpenseSnapshot({
      id: 'expense',
      group_id: 'group',
      created_at: 'today',
      deleted_at: null,
      currentVersion: {
        id: 'version',
        version_no: 1,
        description: 'Lunch',
        category: null,
        expense_date: '2026-11-02',
        currency: 'INR',
        amount: '100',
        split_type: 'equal',
        split_params: { kind: 'equal' },
        pot_id: 'pot',
        payers: [{ member_id: 'treasurer', amount: '100' }],
        shares: [{ member_id: 'member', amount: '100' }],
      },
    });
    expect(expense).toMatchObject({ potId: 'pot', amount: 100n });
    expect(
      toSettlementSnapshot({
        id: 'payment',
        group_id: 'group',
        from_member_id: 'member',
        to_member_id: 'treasurer',
        currency: 'INR',
        amount: '100',
        status: 'confirmed',
        initiated_at: 'today',
        confirmed_at: 'today',
        pot_id: 'pot',
      }),
    ).toMatchObject({ potId: 'pot', amount: 100n });
  });
});
