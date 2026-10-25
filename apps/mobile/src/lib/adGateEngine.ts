import { looksAdBlocked } from './adPacingPure';

export type GateDecision = 'allow' | 'allow_owe' | 'ask';
export function decideGate(i: {
  paid: boolean;
  online: boolean;
  required: boolean | null;
}): GateDecision {
  if (i.paid || i.required === false) return 'allow';
  if (!i.online || i.required === null) return 'allow_owe';
  return 'ask';
}
export type FailureClass = 'offline' | 'blocked' | 'nofill_allow' | 'retry';
export const NOFILL_ALLOW_AFTER = 3;
export function isNoFill(failure: string): boolean {
  return /no-fill|timeout|internal-error|mediation-no-fill/i.test(failure);
}
export function classifyFailure(i: {
  online: boolean;
  failure: string;
  adHostReachable: boolean | null;
  noFillStreak: number;
}): FailureClass {
  if (!i.online) return 'offline';
  if (
    looksAdBlocked(i.failure) ||
    (/network-error/i.test(i.failure) && i.adHostReachable === false)
  )
    return 'blocked';
  if (isNoFill(i.failure) && i.noFillStreak >= NOFILL_ALLOW_AFTER) return 'nofill_allow';
  return 'retry';
}
export function shouldProbeAdHost(i: { online: boolean; failure: string }): boolean {
  return i.online && /network-error|unknown/i.test(i.failure) && !looksAdBlocked(i.failure);
}
export interface OwedAd {
  placement: 'group_create_rewarded' | 'export_rewarded';
  createdAt: number;
  prompts: number;
}
export const OWED_MAX_PROMPTS = 3;
export const OWED_TTL_MS = 7 * 86400000;
export function oweAd(
  existing: OwedAd | null,
  placement: OwedAd['placement'],
  now: number,
): OwedAd {
  return existing ?? { placement, createdAt: now, prompts: 0 };
}
export function shouldOfferOwed(
  debt: OwedAd | null,
  i: { now: number; online: boolean; paid: boolean; promptedThisSession: boolean; busy: boolean },
): 'offer' | 'wait' | 'clear' | 'none' {
  if (!debt) return 'none';
  if (i.paid || i.now - debt.createdAt >= OWED_TTL_MS || debt.prompts >= OWED_MAX_PROMPTS)
    return 'clear';
  if (!i.online || i.promptedThisSession || i.busy) return 'wait';
  return 'offer';
}
export function afterOwedOutcome(
  debt: OwedAd,
  outcome: 'completed' | 'skipped' | 'failed' | 'cancelled' | 'declined',
): OwedAd | null {
  if (outcome === 'completed') return null;
  if (outcome === 'declined' || outcome === 'skipped') {
    return debt.prompts + 1 >= OWED_MAX_PROMPTS ? null : { ...debt, prompts: debt.prompts + 1 };
  }
  return debt;
}
