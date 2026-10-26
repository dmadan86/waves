import { expect, it } from 'vitest';

import { answerFollowUps, isFinalAgentTextAnswer } from '@/lib/voiceAnswerFollowUps';

it('offers the opposite balance direction and relevant next actions', () => {
  expect(answerFollowUps({ kind: 'owed', direction: 'owed' })).toEqual([
    'owe',
    'settle',
    'expense',
  ]);
  expect(answerFollowUps({ kind: 'owed', direction: 'owe' })).toEqual([
    'owed',
    'settle',
    'expense',
  ]);
  for (const kind of ['text', 'group', 'spend']) {
    expect(answerFollowUps({ kind })).toEqual(['owed', 'expense']);
  }
});

it('offers agent next steps only for final read-only text', () => {
  expect(isFinalAgentTextAnswer({ answer: 'All settled.', clarify: null, cards: [] })).toBe(true);
  expect(isFinalAgentTextAnswer(null)).toBe(false);
  expect(isFinalAgentTextAnswer({ answer: null, clarify: null, cards: [] })).toBe(false);
  expect(
    isFinalAgentTextAnswer({ answer: 'Choose a group.', clarify: 'Which group?', cards: [] }),
  ).toBe(false);
  expect(isFinalAgentTextAnswer({ answer: 'Please confirm.', clarify: null, cards: [{}] })).toBe(
    false,
  );
});
