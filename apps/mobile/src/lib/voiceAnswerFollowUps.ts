export type AnswerFollowUp = 'owed' | 'owe' | 'settle' | 'expense';

export function answerFollowUps(
  answer: { kind: string; direction?: 'owed' | 'owe' } | null,
): readonly AnswerFollowUp[] {
  return answer?.kind === 'owed'
    ? [answer.direction === 'owed' ? 'owe' : 'owed', 'settle', 'expense']
    : ['owed', 'expense'];
}

export function isFinalAgentTextAnswer(
  plan: { answer: string | null; clarify: string | null; cards: readonly unknown[] } | null,
): boolean {
  return Boolean(plan?.answer && !plan.clarify && plan.cards.length === 0);
}
