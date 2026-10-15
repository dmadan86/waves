/**
 * The automatic Pro trial, as the app reads it. Pure: the server decides
 * (`waves_my_plan` answers `trial: true` while the trial is the person's Pro),
 * the app only shows how many days and voice commands are left.
 */

export interface ProTrial {
  readonly endsAt: Date;
  readonly voiceLimit: number;
  readonly voiceUsed: number;
}

const DAY_MS = 86_400_000;

/** `waves_my_plan`'s answer as a trial, or null when the person is not on one. */
export function parseProTrial(data: unknown): ProTrial | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  if (row.trial !== true || typeof row.trialEndsAt !== 'string') return null;
  const endsAt = new Date(row.trialEndsAt);
  if (Number.isNaN(endsAt.getTime())) return null;
  const num = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    endsAt,
    voiceLimit: num(row.trialVoiceLimit, 20),
    voiceUsed: num(row.trialVoiceUsed, 0),
  };
}

/** Whole days left, rounded up (a trial with 3 hours left has 1 day left); 0 once over. */
export function trialDaysLeft(trial: Pick<ProTrial, 'endsAt'>, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((trial.endsAt.getTime() - now.getTime()) / DAY_MS));
}

/** The trial's voice commands still available. */
export function trialVoiceLeft(trial: Pick<ProTrial, 'voiceLimit' | 'voiceUsed'>): number {
  return Math.max(0, trial.voiceLimit - trial.voiceUsed);
}
