/**
 * From the tap to a live mic without the serial waits: the entitlement wait
 * decided by the last-known answer, and the installed-model probe asked once.
 */

import { describe, expect, it } from 'vitest';

import {
  AGENT_WAIT_MS,
  AGENT_WAIT_UNKNOWN_MS,
  parseLastKnown,
  planAgentWait,
} from '@/lib/voiceStartPure';

describe('planAgentWait', () => {
  const base = { ready: false, streamLive: false, lastKnown: null, streamAvailable: true };

  it('does not wait once the live answer is in, and records early only to stream', () => {
    expect(planAgentWait({ ...base, ready: true, streamLive: true })).toEqual({
      earlyCapture: true,
      waitMs: 0,
    });
    expect(planAgentWait({ ...base, ready: true, streamLive: false })).toEqual({
      earlyCapture: false,
      waitMs: 0,
    });
  });

  it('opens on-device at once when the last answer was "not Pro"', () => {
    expect(planAgentWait({ ...base, lastKnown: false })).toEqual({
      earlyCapture: false,
      waitMs: 0,
    });
  });

  it('keeps recording from the press and waits as before when the last answer was Pro', () => {
    expect(planAgentWait({ ...base, lastKnown: true })).toEqual({
      earlyCapture: true,
      waitMs: AGENT_WAIT_MS,
    });
  });

  it('waits only briefly when there is no last answer', () => {
    const plan = planAgentWait({ ...base, lastKnown: null });
    expect(plan).toEqual({ earlyCapture: true, waitMs: AGENT_WAIT_UNKNOWN_MS });
    expect(AGENT_WAIT_UNKNOWN_MS).toBeLessThan(AGENT_WAIT_MS);
  });

  it('never records early on a build that cannot stream', () => {
    for (const lastKnown of [true, false, null]) {
      expect(planAgentWait({ ...base, lastKnown, streamAvailable: false }).earlyCapture).toBe(
        false,
      );
    }
    expect(
      planAgentWait({ ...base, ready: true, streamLive: true, streamAvailable: false })
        .earlyCapture,
    ).toBe(false);
  });

  it('lets a live answer override the last-known one', () => {
    expect(planAgentWait({ ...base, ready: true, streamLive: false, lastKnown: true })).toEqual({
      earlyCapture: false,
      waitMs: 0,
    });
  });
});

describe('parseLastKnown', () => {
  it('reads only an exact true or false', () => {
    expect(parseLastKnown('true')).toBe(true);
    expect(parseLastKnown('false')).toBe(false);
    expect(parseLastKnown(null)).toBeNull();
    expect(parseLastKnown(undefined)).toBeNull();
    expect(parseLastKnown('yes')).toBeNull();
  });
});
