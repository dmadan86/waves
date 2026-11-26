import { expect, it } from 'vitest';

import { isLastMember } from '../src/lib/leaveGroup';

it('is the last member when nobody else is still in the group', () => {
  expect(isLastMember([{ left_at: null }])).toBe(true);
  expect(isLastMember([{ left_at: null }, { left_at: '2026-11-01T00:00:00Z' }])).toBe(true);
  expect(isLastMember([{ left_at: null }, { left_at: null }])).toBe(false);
});
