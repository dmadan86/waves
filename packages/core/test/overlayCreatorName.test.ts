import { expect, it } from 'vitest';

import {
  emptyMirror,
  enqueue,
  materialiseMembers,
  MutationKind,
  type MutationEnvelope,
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
