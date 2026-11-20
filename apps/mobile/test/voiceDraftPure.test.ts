import { describe, expect, it } from 'vitest';

import {
  heardCaptureInput,
  leaveUpdatesDraft,
  unclearAmount,
  worthFiling,
} from '@/lib/voiceDraftPure';

describe('heardCaptureInput', () => {
  it('files the sentence with no amount, kept as the words too', () => {
    expect(heardCaptureInput('  lunch with Ravi ', '2026-11-19', 'INR')).toEqual({
      description: 'lunch with Ravi',
      expenseDate: '2026-11-19',
      currency: 'INR',
      amount: 0n,
      rawText: 'lunch with Ravi',
      parsed: { voiceTranscript: 'lunch with Ravi' },
    });
  });
  it('skips a cough', () => {
    expect(worthFiling(' a ')).toBe(false);
    expect(worthFiling('tea')).toBe(true);
  });
});

describe('leaveUpdatesDraft', () => {
  it('writes the review over the draft only when every row is savable', () => {
    expect(leaveUpdatesDraft('review', 1, true)).toBe(true);
    expect(leaveUpdatesDraft('review', 1, false)).toBe(false);
    expect(leaveUpdatesDraft('review', 0, true)).toBe(false);
  });
  it('leaves the filed draft alone in every other phase', () => {
    for (const phase of ['listening', 'thinking', 'agent', 'saved', 'committing'])
      expect(leaveUpdatesDraft(phase, 2, true)).toBe(false);
  });
});

describe('unclearAmount', () => {
  it('reads a plain number', () => {
    expect(unclearAmount('3,000')).toBe('3000');
    expect(unclearAmount('450.50')).toBe('450.50');
  });
  it('rejects words, zero and empty', () => {
    expect(unclearAmount('lots')).toBeNull();
    expect(unclearAmount('0')).toBeNull();
    expect(unclearAmount('')).toBeNull();
  });
});
