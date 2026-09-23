/**
 * The remind button: one reminder per tap however fast the taps come, an
 * outcome in words once it lands, and a send that never throws.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UiStrings } from '../src/i18n';
import { sendNudge, useNudge } from '../src/lib/nudge';
import { act, flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

const h = vi.hoisted(() => ({
  nudgeToSettle: vi.fn(),
  t: {
    people: {
      reminded: 'Reminded',
      remindedToday: 'Already reminded today',
      remindFailed: 'Failed',
    },
  },
}));

vi.mock('@/data/api', () => ({ nudgeToSettle: h.nudgeToSettle }));
vi.mock('@/i18n', () => ({ useStrings: () => ({ t: h.t }) }));

const target = { groupId: 'g1', memberId: 'm2', currency: 'INR' };
const t = h.t as unknown as UiStrings;

beforeEach(() => {
  h.nudgeToSettle.mockReset().mockResolvedValue(undefined);
});

describe('sendNudge', () => {
  it('asks the server to remind that member in that currency', async () => {
    await expect(sendNudge(target, t)).resolves.toEqual({ ok: true, label: 'Reminded' });
    expect(h.nudgeToSettle).toHaveBeenCalledWith({
      groupId: 'g1',
      toMemberId: 'm2',
      currency: 'INR',
    });
  });

  it('reads the rate limit as already done, and anything else as a failure', async () => {
    h.nudgeToSettle.mockRejectedValueOnce(new Error('NUDGE_RATE_LIMIT'));
    await expect(sendNudge(target, t)).resolves.toEqual({
      ok: true,
      label: 'Already reminded today',
    });
    h.nudgeToSettle.mockRejectedValueOnce(new Error('offline'));
    await expect(sendNudge(target, t)).resolves.toEqual({ ok: false, label: 'Failed' });
  });
});

describe('useNudge', () => {
  it('is pending while the send is in flight, then shows the outcome', async () => {
    let resolve!: () => void;
    h.nudgeToSettle.mockReturnValueOnce(new Promise<void>((r) => (resolve = r)));
    const view = renderHook(() => useNudge(target));
    expect(view.result.current).toMatchObject({ pending: false, outcome: null });

    act(() => view.result.current.send());
    expect(view.result.current.pending).toBe(true);

    resolve();
    await flush();
    expect(view.result.current).toMatchObject({
      pending: false,
      outcome: { ok: true, label: 'Reminded' },
    });
  });

  it('sends once for two taps in the same frame', async () => {
    const view = renderHook(() => useNudge(target));
    const { send } = view.result.current;
    act(() => {
      send();
      send();
    });
    await flush();
    expect(h.nudgeToSettle).toHaveBeenCalledTimes(1);

    // Once it has landed, the next tap is a fresh reminder.
    view.result.current.send();
    await flush();
    expect(h.nudgeToSettle).toHaveBeenCalledTimes(2);
  });
});
