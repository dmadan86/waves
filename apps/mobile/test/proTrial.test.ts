import { describe, expect, it } from 'vitest';

import { parseProTrial, trialDaysLeft, trialVoiceLeft } from '../src/lib/proTrial';

const now = new Date('2026-10-20T12:00:00Z');

describe('parseProTrial', () => {
  it('reads the trial waves_my_plan reports', () => {
    const trial = parseProTrial({
      plan: 'pro',
      trial: true,
      trialEndsAt: '2026-11-04T12:00:00Z',
      trialVoiceLimit: 20,
      trialVoiceUsed: 6,
    });
    expect(trial).not.toBeNull();
    expect(trialDaysLeft(trial!, now)).toBe(15);
    expect(trialVoiceLeft(trial!)).toBe(14);
  });

  it('is null off the trial: free, paid, junk', () => {
    expect(parseProTrial({ plan: 'free' })).toBeNull();
    expect(parseProTrial({ plan: 'pro', source: 'subscription' })).toBeNull();
    expect(parseProTrial({ trial: true, trialEndsAt: 'not a date' })).toBeNull();
    expect(parseProTrial(null)).toBeNull();
    expect(parseProTrial('x')).toBeNull();
  });
});

describe('trialDaysLeft', () => {
  it('rounds a part day up and bottoms out at zero', () => {
    expect(trialDaysLeft({ endsAt: new Date('2026-10-20T15:00:00Z') }, now)).toBe(1);
    expect(trialDaysLeft({ endsAt: new Date('2026-10-22T12:00:00Z') }, now)).toBe(2);
    expect(trialDaysLeft({ endsAt: new Date('2026-10-19T12:00:00Z') }, now)).toBe(0);
  });
});

describe('trialVoiceLeft', () => {
  it('never goes below zero', () => {
    expect(trialVoiceLeft({ voiceLimit: 20, voiceUsed: 25 })).toBe(0);
    expect(trialVoiceLeft({ voiceLimit: 20, voiceUsed: 0 })).toBe(20);
  });
});
