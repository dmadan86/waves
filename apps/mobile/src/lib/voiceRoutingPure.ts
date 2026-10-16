/**
 * Who streams to Deepgram and who listens on the phone — pure, so it is tested
 * apart from the screen.
 *
 * Pro and the Pro trial stream the mic live to Deepgram (the cloud engine).
 * Free — including the commands earned by watching a reward ad — uses the
 * phone's own speech recogniser and sends the transcript as text to the
 * `voice-agent` function, which is about a seventh of the cost per command. The
 * server enforces the same split (`waves_voice_stream_mint` refuses Free), so
 * this only decides what the app asks for first.
 */

import { PlanTier } from '@waves/core';

import { tierFromServerPlan } from '@/lib/planTier';

/**
 * Whether the mic should stream live. `waves_my_plan`'s answer, the store's own
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
