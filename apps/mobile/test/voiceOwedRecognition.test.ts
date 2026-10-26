import { describe, expect, it } from 'vitest';

import { detectOwedDirection } from '@/lib/voiceExpense';
import { owedQuestionTranscript } from '@/lib/voiceFastPath';

describe('short owed questions heard by ASR', () => {
  it('accepts common confusions only as whole short questions', () => {
    for (const phrase of ['who was me', 'who owe me', 'who owns me', 'who knows me']) {
      for (const suffix of ['', ' money', ' overall', ' across groups', ' money overall']) {
        expect(detectOwedDirection(`${phrase}${suffix}?`)).toBe('owed');
      }
    }
    for (const phrase of ['who do i own', 'who do i o']) {
      for (const suffix of ['', ' money', ' overall', ' across groups']) {
        expect(detectOwedDirection(`${phrase}${suffix}`)).toBe('owe');
      }
    }
    for (const phrase of [
      'who was at dinner',
      'who knows me from work',
      'who owns me a car',
      'who do i own a house with',
    ]) {
      expect(detectOwedDirection(phrase)).toBeNull();
    }
  });

  it('uses an owed alternative when the top reading misses', () => {
    expect(owedQuestionTranscript('Who is me?', ['Who owes me?'], [])).toBe('Who owes me?');
    expect(owedQuestionTranscript('Who is me?', ['Who do I owe overall?'], [])).toBe(
      'Who do I owe overall?',
    );
    expect(owedQuestionTranscript('Who owes me?', ['Who do I owe?'], [])).toBe('Who owes me?');
    expect(owedQuestionTranscript('Who was at dinner?', ['Who was there?'], [])).toBeNull();
  });

  it('keeps named group questions out of the overall fallback', () => {
    const groups = [{ id: 'g-goa', name: 'Goa' }];
    expect(owedQuestionTranscript('Who is me?', ['Who owes me in Goa?'], groups)).toBeNull();
    expect(owedQuestionTranscript('Who is me?', ['Who owes me overall?'], groups)).toBe(
      'Who owes me overall?',
    );
  });
});
