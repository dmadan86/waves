import { describe, expect, it } from 'vitest';

import { claimsToConfirm } from '@/lib/settleRow';

const row = (id: string, status: string, from: string, to: string) => ({
  id,
  status,
  from_member_id: from,
  to_member_id: to,
});

describe('claimsToConfirm', () => {
  const rows = [
    row('s1', 'initiated', 'b', 'a'),
    row('s2', 'confirmed', 'b', 'a'),
    row('s3', 'initiated', 'a', 'b'),
    row('s4', 'initiated', 'c', 'a'),
  ];
  it('lists only their unconfirmed payments to me', () => {
    expect(claimsToConfirm(rows, 'a', 'b')).toEqual(['s1']);
  });
  it('is empty when I am unknown', () => {
    expect(claimsToConfirm(rows, null, 'b')).toEqual([]);
  });
});
