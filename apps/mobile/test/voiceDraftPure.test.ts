import { describe, expect, it } from 'vitest';

import {
  heardCaptureInput,
  leftoverCaptureInput,
  leaveUpdatesDraft,
  unclearAmount,
  worthFiling,
} from '@/lib/voiceDraftPure';

describe('heardCaptureInput', () => {
  it('files several expenses with their total', () => {
    const input = heardCaptureInput(
      '80 rupees for food, 10 for petrol and 1 for tea',
      '2026-11-21',
      'INR',
    );
    expect(input.amount).toBe(9100n);
    expect(input.description).toBe('80 rupees for food, 10 for petrol and 1 for tea');
  });

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

describe('heardCaptureInput amount fill', () => {
  it('carries the amount and what it was for when one expense is heard', () => {
    const draft = heardCaptureInput('500 for carpooling', '2026-11-19', 'INR');
    expect(draft.amount).toBe(50000n);
    expect(draft.description).toContain('carpooling');
    expect(draft.rawText).toBe('500 for carpooling');
  });
  it('stays at 0 when nothing numeric was heard', () => {
    expect(heardCaptureInput('for current editing football', '2026-11-19', 'INR').amount).toBe(0n);
  });
});

describe('leftoverCaptureInput', () => {
  it('holds only what was not added, with its total', () => {
    const input = leftoverCaptureInput(
      'tea 10 and 40',
      [{ amountMajor: 40, note: '', currency: null }],
      '2026-11-21',
      'INR',
    );
    expect(input.amount).toBe(4000n);
    expect(input.description).toBe('tea 10 and 40');
    expect(input.rawText).toBe('tea 10 and 40');
  });
});
