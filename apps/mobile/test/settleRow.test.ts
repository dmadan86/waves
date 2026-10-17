import { describe, expect, it } from 'vitest';

import { GhostChannel } from '../src/lib/ghostReminder';
import { leftWithBalance, OwedRemind, OwedStatus, owedRowModel } from '../src/lib/settleRow';

const base = {
  joined: true,
  hasMember: true,
  left: false,
  pending: false,
  nudged: false,
  reminded: false,
  channel: GhostChannel.Share,
};

describe('owedRowModel', () => {
  it('gives someone on Waves the app nudge and no (i)', () => {
    expect(owedRowModel(base)).toEqual({
      status: OwedStatus.Tap,
      remind: OwedRemind.Push,
      info: false,
    });
  });

  it('drops the pill once the nudge has answered, and says so', () => {
    expect(owedRowModel({ ...base, nudged: true })).toEqual({
      status: OwedStatus.Feedback,
      remind: null,
      info: false,
    });
  });

  it('picks the pill icon from the ghost channel, with the (i)', () => {
    const ghost = { ...base, joined: false };
    expect(owedRowModel({ ...ghost, channel: GhostChannel.WhatsApp }).remind).toBe(
      OwedRemind.WhatsApp,
    );
    expect(owedRowModel({ ...ghost, channel: GhostChannel.Email }).remind).toBe(OwedRemind.Email);
    expect(owedRowModel({ ...ghost, channel: GhostChannel.Share })).toEqual({
      status: OwedStatus.NotOnWaves,
      remind: OwedRemind.Share,
      info: true,
    });
  });

  it('words every left member the same, whatever the channel', () => {
    const wa = owedRowModel({ ...base, joined: false, left: true, channel: GhostChannel.WhatsApp });
    const share = owedRowModel({ ...base, joined: false, left: true, channel: GhostChannel.Share });
    const account = owedRowModel({ ...base, left: true });
    expect(wa.status).toBe(OwedStatus.Left);
    expect(share.status).toBe(OwedStatus.Left);
    expect(account.status).toBe(OwedStatus.Left);
  });

  it('shows feedback after an off-app reminder and no second pill', () => {
    expect(owedRowModel({ ...base, joined: false, reminded: true })).toEqual({
      status: OwedStatus.Feedback,
      remind: null,
      info: false,
    });
  });

  it('offers no reminder to a ghost with no member row', () => {
    expect(owedRowModel({ ...base, joined: false, hasMember: false }).remind).toBeNull();
  });

  it('shows pending ahead of left for a member on Waves', () => {
    expect(owedRowModel({ ...base, pending: true, left: true }).status).toBe(OwedStatus.Pending);
  });
});

describe('leftWithBalance', () => {
  const members = [
    { id: 'a', left_at: null },
    { id: 'b', left_at: '2026-01-01' },
    { id: 'c', left_at: '2026-01-01' },
    { id: 'd', left_at: '2026-01-01' },
  ];
  it('counts only departed members who still owe or are owed', () => {
    const balances = new Map<string, bigint>([
      ['a', 500n],
      ['b', 15000n],
      ['c', -200n],
      ['d', 0n],
    ]);
    expect(leftWithBalance(members, balances)).toBe(2);
  });
  it('is zero when nobody left with a balance', () => {
    expect(leftWithBalance(members, new Map())).toBe(0);
  });
});
