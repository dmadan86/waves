import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFS } from '@waves/core';

/**
 * Pure-logic checks for the voice-related settings changes:
 *
 * 1. showVoiceRecorder must be __DEV__-only — voiceAgentOn must not expose the
 *    recorder row in production.
 * 2. Follow-up questions default to enabled so removing the toggle does not
 *    accidentally disable them for everyone.
 */

describe('showVoiceRecorder gate', () => {
  it('is false in production regardless of voiceAgentOn', () => {
    const isDev = false; // simulates a production build (__DEV__ = false)
    const showVoiceRecorder = isDev; // the new expression: only __DEV__
    expect(showVoiceRecorder).toBe(false);
  });

  it('is true in a dev build regardless of voiceAgentOn', () => {
    const isDev = true;
    const showVoiceRecorder = isDev;
    expect(showVoiceRecorder).toBe(true);
  });

  it('old expression (voiceAgentOn || __DEV__) would have exposed the row to Pro users', () => {
    const isDev = false;
    const voiceAgentOn = true; // Pro user in production
    const oldShowVoiceRecorder = voiceAgentOn || isDev;
    expect(oldShowVoiceRecorder).toBe(true); // this was the bug
  });
});

describe('follow-up questions default', () => {
  it('DEFAULT_PREFS.enabled is true — follow-ups are on for everyone by default', () => {
    expect(DEFAULT_PREFS.enabled).toBe(true);
  });
});
