import { expect, it } from 'vitest';

import { answerFollowUps } from '@/lib/voiceAnswerFollowUps';

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
