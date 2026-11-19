/**
 * Hold-to-talk on the bar's mic, without leaving the screen: the rules that need
 * no microphone, so they can be tested alone.
 */

import { voiceAutoAction, type VoiceParseResult } from '@/lib/voiceExpense';

export type HoldPlan = 'overlay' | 'screen';

/**
 * Hold on the spot, or open the voice screen. Anything that needs a question
 * asked (first-run consent, the mic permission) or is not known yet goes to the
 * screen, where those flows already live.
 */
export function holdPlan(input: {
  recognition: boolean;
  micGranted: boolean;
  statusReady: boolean;
  consentReady: boolean;
  agentServerOn: boolean;
  consent: 'needed' | 'granted' | 'revoked';
}): HoldPlan {
  if (!input.recognition || !input.micGranted) return 'screen';
  if (!input.statusReady || !input.consentReady) return 'screen';
  // The same condition under which /voice shows its consent sheet.
  if (input.agentServerOn && input.consent === 'needed') return 'screen';
  return 'overlay';
}

/** "0:03" */
export function formatHoldTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export type HoldLanding =
  { kind: 'group'; groupId: string } | { kind: 'personal' } | { kind: 'later' };

/**
 * Where a parsed sentence lands with no review: the same auto-add rule as the
 * voice screen, and anything it would not add by itself stays a draft.
 */
export function holdLanding(
  result: VoiceParseResult,
  context: { launchGroupId: string | null; launchPersonal: boolean },
  openGroupIds: ReadonlySet<string>,
): HoldLanding {
  const auto = voiceAutoAction(result, context);
  if (auto?.kind !== 'commit-expense') return { kind: 'later' };
  if (auto.groupId === null) return { kind: 'personal' };
  return openGroupIds.has(auto.groupId)
    ? { kind: 'group', groupId: auto.groupId }
    : { kind: 'later' };
}

/** The agent's answer is added with no review only when it is one clean expense. */
export function agentAddsAtOnce(plan: {
  cards: readonly { problem: boolean; action: { type: string } }[];
  answer: string | null;
  clarify: string | null;
}): boolean {
  const [only] = plan.cards;
  return (
    plan.cards.length === 1 &&
    !!only &&
    !only.problem &&
    !plan.answer &&
    !plan.clarify &&
    (only.action.type === 'add_expense' || only.action.type === 'add_personal')
  );
}
