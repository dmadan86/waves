/**
 * An in-memory stand-in for `waves_voice_agent_followup` (the SQL function in
 * migration 20261021120000_voice_agent_followup_meter): same refusal order and
 * reasons, so handler tests exercise the edge function's use of it. The SQL
 * itself is covered by packages/db/test/voice-agent-followup.test.ts.
 */

export interface FollowupMeterOptions {
  /** The plan the database would decide for the caller. */
  tier?: 'free' | 'pro';
}

export function followupMeter(options: FollowupMeterOptions = {}) {
  const perExpense = new Map<string, number>();
  let month = 0;
  return (args: Record<string, unknown>) => {
    if ((options.tier ?? 'pro') === 'free') {
      return { used: 0, limit: 0, tier: 'free', allowed: false, reason: 'free_tier' };
    }
    const monthLimit = Number(args.p_month_limit);
    const expenseLimit = Number(args.p_expense_limit);
    const key = String(args.p_expense_id);
    const turns = perExpense.get(key) ?? 0;
    if (turns >= expenseLimit) {
      return { used: month, limit: monthLimit, tier: 'pro', allowed: false, reason: 'expense_cap' };
    }
    if (month >= monthLimit) {
      return { used: month, limit: monthLimit, tier: 'pro', allowed: false, reason: 'month_cap' };
    }
    perExpense.set(key, turns + 1);
    month += 1;
    return { used: month, limit: monthLimit, tier: 'pro', allowed: true };
  };
}
