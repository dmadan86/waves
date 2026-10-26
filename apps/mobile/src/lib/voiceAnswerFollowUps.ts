export type AnswerFollowUp = 'owed' | 'owe' | 'settle' | 'expense';

export function answerFollowUps(
  answer: { kind: string; direction?: 'owed' | 'owe' } | null,
): readonly AnswerFollowUp[] {
  return answer?.kind === 'owed'
    ? [answer.direction === 'owed' ? 'owe' : 'owed', 'settle', 'expense']
    : ['owed', 'expense'];
}
