import { expect, it } from 'vitest';

import {
  emptyMirror,
  enqueue,
  materialiseMembers,
  materialiseSettlements,
  MutationKind,
  type MutationEnvelope,
  type QueuedMutation,
} from '../src/index.js';

it('names the offline creator from the account, so the avatar has real initials', () => {
  const create: MutationEnvelope = {
    clientMutationId: 'm-1',
    kind: MutationKind.GroupCreate,
    groupId: 'g-1',
    clientCreatedAt: '2026-03-01T09:00:00Z',
    payload: {
      name: 'Goa',
      currency: 'INR',
      creatorMemberId: 'me-1',
      creatorProfileId: 'profile-1',
      creatorName: 'QA One',
    },
  };
  const [creator] = materialiseMembers(emptyMirror(), enqueue([], create), { groupId: 'g-1' });
  expect(creator).toMatchObject({ profile: { id: 'profile-1', display_name: 'QA One' } });
});

it('shows a settlement recorded by the payee as confirmed, and the payer-recorded one as pending', () => {
  const make = (confirmed: boolean, seq: number): QueuedMutation =>
    ({
      clientMutationId: `s${seq}`,
      kind: MutationKind.SettlementCreate,
      groupId: 'g',
      seq,
      clientCreatedAt: '2026-11-26T10:00:00.000Z',
      payload: { settlementId: `st${seq}`, confirmed, from: 'a', to: 'b', amount: '100' },
    }) as unknown as QueuedMutation;
  const rows = materialiseSettlements(emptyMirror(), [make(true, 1), make(false, 2)], {
    groupId: 'g',
  });
  expect(rows.find((r) => r.id === 'st1')?.status).toBe('confirmed');
  expect(rows.find((r) => r.id === 'st2')?.status).toBe('initiated');
});
