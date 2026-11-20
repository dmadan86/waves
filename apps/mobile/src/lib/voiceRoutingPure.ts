/**
 * Who streams to Deepgram and who listens on the phone — pure, so it is tested
 * apart from the screen.
 *
 * Everyone signed in streams speech-to-text to Deepgram (Nova-3, via the relay)
 * for their own monthly clip budget; the phone's recogniser is only the fallback
 * (offline, over budget, stream refused). Only the Claude agent step is Pro:
 * `streamsToCloud` says who gets the whole-clip batch fallback and the agent
 * path that takes audio, which is Pro and the Pro trial.
 */

import { PlanTier } from '@waves/core';

import { tierFromServerPlan } from '@/lib/planTier';

/**
 * Whether this person gets Pro's cloud path (whole-clip batch, agent on audio). `waves_my_plan`'s answer, the store's own
 * view of the tier and the time decide: a paid plan, the Pro trial, or the
 * trial's 30-day voice pool streams; everyone else is Free.
 */
export function streamsToCloud(
  plan: unknown,
  storeTier: PlanTier = PlanTier.Free,
  now: Date = new Date(),
): boolean {
  if (storeTier !== PlanTier.Free) return true;
  if (!plan || typeof plan !== 'object') return false;
  const row = plan as Record<string, unknown>;
  if (tierFromServerPlan(row.plan) !== PlanTier.Free) return true;
  if (row.trial === true) return true;
  const until = typeof row.trialVoiceUntil === 'string' ? new Date(row.trialVoiceUntil) : null;
  return !!until && !Number.isNaN(until.getTime()) && until.getTime() > now.getTime();
}
