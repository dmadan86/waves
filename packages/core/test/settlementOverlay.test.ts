import { describe, expect, it } from 'vitest';

import { emptyMirror, materialiseSettlements } from '../src/index';

describe('settlement.transition overlay', () => {
  const state = (status: string) => {
    const base = emptyMirror();
    return {
      ...base,
      tables: {
        ...base.tables,
        settlements: {
          s1: {
            id: 's1',
            group_id: 'g',
            from_member_id: 'a',
            to_member_id: 'b',
            currency: 'INR',
            amount: '30000',
            status,
            initiated_at: '2026-11-26T10:00:00Z',
            confirmed_at: null,
          },
        },
      },
    } as never;
  };
  const confirm = (rejection: unknown = null) =>
    [
      {
        seq: 1,
        kind: 'settlement.transition',
        groupId: 'g',
        clientMutationId: 'c1',
        clientCreatedAt: '2026-11-26T11:00:00Z',
        payload: { settlementId: 's1', to: 'confirmed' },
        rejection,
      },
    ] as never;

  it('confirms a pending payment optimistically', () => {
    expect(materialiseSettlements(state('initiated'), confirm(), { groupId: 'g' })[0]?.status).toBe(
      'confirmed',
    );
  });
  it('does not confirm a payment the payer already withdrew', () => {
    expect(materialiseSettlements(state('cancelled'), confirm(), { groupId: 'g' })[0]?.status).toBe(
      'cancelled',
    );
  });
  it('ignores a refused transition', () => {
    const refused = { code: 'check_violation', message: 'x' };
    expect(
      materialiseSettlements(state('initiated'), confirm(refused), { groupId: 'g' })[0]?.status,
    ).toBe('initiated');
  });
});
