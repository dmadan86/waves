import { describe, expect, it } from 'vitest';

import {
  leftWithBalance,
  OwedStatus,
  owedRowModel,
  parseRemindChannel,
  RemindChannel,
  remindOptions,
  RemindUnavailable,
} from '../src/lib/settleRow';

const base = {
  joined: true,
  hasMember: true,
  left: false,
  pending: false,
  reminded: false,
};

describe('owedRowModel', () => {
  it('gives every kind of member the same Remind pill', () => {
    expect(owedRowModel(base)).toEqual({ status: OwedStatus.Tap, remind: true });
    expect(owedRowModel({ ...base, joined: false })).toEqual({
      status: OwedStatus.NotOnWaves,
      remind: true,
    });
  });

  it('drops the pill once a reminder went out, and says so', () => {
    expect(owedRowModel({ ...base, reminded: true })).toEqual({
      status: OwedStatus.Feedback,
      remind: false,
    });
    expect(owedRowModel({ ...base, joined: false, reminded: true }).status).toBe(
      OwedStatus.Feedback,
    );
  });

  it('words every left member the same', () => {
    expect(owedRowModel({ ...base, joined: false, left: true }).status).toBe(OwedStatus.Left);
    expect(owedRowModel({ ...base, left: true }).status).toBe(OwedStatus.Left);
  });

  it('offers no reminder to a ghost with no member row', () => {
    expect(owedRowModel({ ...base, joined: false, hasMember: false }).remind).toBe(false);
  });

  it('shows pending ahead of left for a member on Waves', () => {
    expect(owedRowModel({ ...base, pending: true, left: true }).status).toBe(OwedStatus.Pending);
  });
});

describe('remindOptions', () => {
  const channels = (input: Parameters<typeof remindOptions>[0]): RemindChannel[] =>
    remindOptions(input).map((option) => option.channel);

  it('lists all but SMS for someone on Waves, whose phone is not known', () => {
    const options = remindOptions({ joined: true, hasPhone: false, lastUsed: null });
    expect(options.map((o) => o.channel)).toEqual([
      RemindChannel.Waves,
      RemindChannel.WhatsApp,
      RemindChannel.Share,
    ]);
    expect(options.every((o) => o.enabled && o.reason === null)).toBe(true);
  });

  it('disables Waves with its reason for someone not on Waves, and puts it last', () => {
    const options = remindOptions({ joined: false, hasPhone: true, lastUsed: null });
    expect(options.map((o) => o.channel)).toEqual([
      RemindChannel.WhatsApp,
      RemindChannel.Sms,
      RemindChannel.Share,
      RemindChannel.Waves,
    ]);
    const waves = options[3];
    expect(waves.enabled).toBe(false);
    expect(waves.reason).toBe(RemindUnavailable.NotOnWaves);
  });

  it('skips SMS when there is no phone number', () => {
    expect(channels({ joined: false, hasPhone: false, lastUsed: null })).not.toContain(
      RemindChannel.Sms,
    );
  });

  it('leads with the last-used channel and tags it', () => {
    const options = remindOptions({ joined: true, hasPhone: true, lastUsed: RemindChannel.Sms });
    expect(options[0].channel).toBe(RemindChannel.Sms);
    expect(options.filter((o) => o.lastUsed)).toHaveLength(1);
    expect(options.slice(1).map((o) => o.channel)).toEqual([
      RemindChannel.Waves,
      RemindChannel.WhatsApp,
      RemindChannel.Share,
    ]);
  });

  it('does not promote or tag a last-used channel that is unavailable now', () => {
    const options = remindOptions({
      joined: false,
      hasPhone: true,
      lastUsed: RemindChannel.Waves,
    });
    expect(options[0].channel).toBe(RemindChannel.WhatsApp);
    expect(options.some((o) => o.lastUsed)).toBe(false);
  });

  it('ignores a last-used SMS when the phone is gone', () => {
    const options = remindOptions({ joined: true, hasPhone: false, lastUsed: RemindChannel.Sms });
    expect(options[0].channel).toBe(RemindChannel.Waves);
    expect(options.some((o) => o.lastUsed)).toBe(false);
  });
});

describe('parseRemindChannel', () => {
  it('reads a stored channel and rejects anything else', () => {
    expect(parseRemindChannel('sms')).toBe(RemindChannel.Sms);
    expect(parseRemindChannel('email')).toBeNull();
    expect(parseRemindChannel(null)).toBeNull();
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
