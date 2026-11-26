import { describe, expect, it } from 'vitest';

import { voiceDestination, voiceSaveDecision } from '../src/lib/voiceReviewDecision';

describe('voice review and destination decisions', () => {
  it('V01/V03: requires review for a clear expense, including AI supplied payer and split', () => {
    expect(voiceSaveDecision(true)).toBe('review');
    expect(voiceSaveDecision(true)).toBe('review');
  });

  it('V02: Home chooses its one spoken group match, and asks for zero or multiple matches', () => {
    expect(voiceDestination({ kind: 'home' }, ['goa'], 'last-used')).toEqual({
      kind: 'group',
      groupId: 'goa',
    });
    expect(voiceDestination({ kind: 'home' }, [], 'last-used')).toEqual({ kind: 'ask' });
    expect(voiceDestination({ kind: 'home' }, ['goa', 'home'], 'last-used')).toEqual({
      kind: 'ask',
    });
  });

  it('V04: launch scope wins over a spoken shared group name', () => {
    expect(voiceDestination({ kind: 'personal' }, ['home'], 'last-used')).toEqual({
      kind: 'personal',
    });
    expect(voiceDestination({ kind: 'group', groupId: 'opened' }, [], 'last-used')).toEqual({
      kind: 'group',
      groupId: 'opened',
    });
  });
});
