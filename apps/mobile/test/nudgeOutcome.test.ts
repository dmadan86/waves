import { describe, expect, it } from 'vitest';

import { nudgeOutcome, nudgeSent } from '@/lib/nudgeOutcome';

const t = {
  people: {
    reminded: 'Reminded',
    remindedToday: 'Nudged today',
    remindFailed: "Couldn't send the reminder",
  },
};

describe('what a reminder came to', () => {
  it('a sent reminder reads as done', () => {
    expect(nudgeSent(t)).toEqual({ ok: true, label: 'Reminded' });
  });

  it('the daily limit reads as already sent, not an error', () => {
    expect(nudgeOutcome(new Error('P0001: NUDGE_RATE_LIMIT'), t)).toEqual({
      ok: true,
      label: 'Nudged today',
    });
  });

  it('any other failure says the send failed, not that something failed to load', () => {
    expect(nudgeOutcome(new Error('network down'), t)).toEqual({
      ok: false,
      label: "Couldn't send the reminder",
    });
    expect(nudgeOutcome('weird', t).ok).toBe(false);
  });
});
