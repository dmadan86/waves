/** Deterministic, bounded pacing. No clock, storage, network or native imports. */
export const AD_PACING_DEFAULTS = {
  gap_min: 3,
  gap_max: 5,
  cooldown_seconds: 180,
  interstitial_daily_cap: 3,
  grace_days: 3,
  grace_expenses: 5,
  rewarded_quiet_seconds: 300,
  session_grace_seconds: 60,
  session_cap: 2,
};
export type AdPacingSettings = typeof AD_PACING_DEFAULTS;
export interface PacingState {
  seed: number;
  total: number;
  since: number;
  gap: number;
  day: string;
  today: number;
  sessionShown: number;
  /** expenseId -> last time an edit of it counted as a step (newest ~20 kept). */
  edited?: Record<string, number>;
}
export function nextGap(seed: number, min: number, max: number) {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return { seed: next, gap: min + (next % (max - min + 1)) };
}
export function initialPacing(seed: number): PacingState {
  return { ...nextGap(seed, 3, 5), total: 0, since: 0, day: '', today: 0, sessionShown: 0 };
}
export interface PacingInput {
  now: number;
  createdAt: number;
  sessionStartedAt: number;
  enabled: boolean;
  paid: boolean;
  personal: boolean;
  saved: boolean;
  /** Set when saving an edit of an existing group expense; the same expense counts once per window. */
  editOf?: string;
  online: boolean;
  lastAdAt: number;
  lastRewardedAt: number;
  lastInterstitialAt: number;
  /** An error or purchase-intent moment suppresses the next transition. */
  sensitiveMoment?: boolean;
}
/** Re-editing the same expense inside this window is one step, not many. */
export const EDIT_WINDOW_MS = 10 * 60000;
export function paceExpense(state: PacingState, input: PacingInput, knobs = AD_PACING_DEFAULTS) {
  if (!input.enabled || input.paid || input.personal || !input.saved || !input.online)
    return { state, show: false, reason: 'ineligible' };
  let edited = state.edited;
  if (input.editOf) {
    const last = edited?.[input.editOf] ?? 0;
    if (last > 0 && input.now - last < EDIT_WINDOW_MS)
      return { state, show: false, reason: 'recent_edit' };
    const newest = Object.entries({ ...edited, [input.editOf]: input.now })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    edited = Object.fromEntries(newest);
  }
  const day = new Date(input.now).toISOString().slice(0, 10);
  const next = {
    ...state,
    edited,
    total: state.total + 1,
    since: state.since + 1,
    day,
    today: day === state.day ? state.today : 0,
  };
  if (
    input.now - input.createdAt < knobs.grace_days * 86400000 ||
    next.total <= knobs.grace_expenses
  )
    return { state: next, show: false, reason: 'blocked_grace' };
  if (
    input.sensitiveMoment ||
    input.now - input.sessionStartedAt < knobs.session_grace_seconds * 1000 ||
    next.today >= knobs.interstitial_daily_cap ||
    next.sessionShown >= knobs.session_cap ||
    (input.lastAdAt > 0 && input.now - input.lastAdAt < 60000) ||
    (input.lastRewardedAt > 0 &&
      input.now - input.lastRewardedAt < knobs.rewarded_quiet_seconds * 1000) ||
    (input.lastInterstitialAt > 0 &&
      input.now - input.lastInterstitialAt < knobs.cooldown_seconds * 1000) ||
    next.since < Math.max(knobs.gap_min, Math.min(knobs.gap_max, next.gap))
  )
    return { state: next, show: false, reason: 'paced' };
  // Consume the budget on attempt too: no-fill never causes a retry on every save.
  return {
    state: {
      ...next,
      ...nextGap(next.seed, knobs.gap_min, knobs.gap_max),
      since: 0,
      today: next.today + 1,
      sessionShown: next.sessionShown + 1,
    },
    show: true,
    reason: 'ready',
  };
}
export type GateResult = 'completed' | 'skipped' | 'failed' | 'cancelled';
/** Only a watched ad unlocks: a failed load (ad blocker, no fill, offline) keeps the gate shut. */
export function gateAllows(result: GateResult): boolean {
  return result === 'completed';
}

export function gateRequired(input: {
  enabled: boolean;
  paid: boolean;
  placement: 'group_create_rewarded' | 'export_rewarded';
  createdGroups: number;
}) {
  return (
    input.enabled &&
    !input.paid &&
    (input.placement === 'export_rewarded' || input.createdGroups > 0)
  );
}

/** Blocking DNS (AdGuard, NextDNS, Pi-hole) answers ad hosts with 0.0.0.0 or nothing; offline is ruled out before loading. */
export function looksAdBlocked(reason: string): boolean {
  return (
    /google|doubleclick|admob|gstatic|pagead|2mdn/i.test(reason) &&
    /(?:^|[^\d.])(?:0\.0\.0\.0|127\.0\.0\.1)(?=$|[^\d.])|\[::\]|(?:^|[^\w:])::(?=$|[^\w:])|unable to resolve host/i.test(
      reason,
    )
  );
}
