/**
 * How the "Rewarded ads" block reads: totals over the days shown. Pure and
 * dependency-free so a test can import it (`lib/data` is `server-only`).
 */

export interface AdsDayLike {
  rewards: number | string;
  voice_rewards: number | string;
  scan_rewards: number | string;
  cap_hits: number | string;
}

const count = (value: number | string): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export interface AdsTotals {
  rewards: number;
  voice: number;
  scan: number;
  /** Person-days that reached the daily cap. */
  capHits: number;
}

export function adsTotals(rows: readonly AdsDayLike[]): AdsTotals {
  return rows.reduce<AdsTotals>(
    (sum, row) => ({
      rewards: sum.rewards + count(row.rewards),
      voice: sum.voice + count(row.voice_rewards),
      scan: sum.scan + count(row.scan_rewards),
      capHits: sum.capHits + count(row.cap_hits),
    }),
    { rewards: 0, voice: 0, scan: 0, capHits: 0 },
  );
}

export const creditKnobs = [
  { key: 'credits_per_ad', label: 'Credits per rewarded ad', min: 1, max: 100, defaultValue: 6 },
  { key: 'voice_cost', label: 'AI voice cost', min: 1, max: 100, defaultValue: 1 },
  { key: 'scan_cost', label: 'Receipt scan cost', min: 1, max: 100, defaultValue: 2 },
  { key: 'export_cost', label: 'Export cost', min: 1, max: 100, defaultValue: 6 },
  { key: 'group_cost', label: 'Additional group cost', min: 1, max: 100, defaultValue: 6 },
  { key: 'wallet_cap', label: 'Wallet cap', min: 1, max: 1000, defaultValue: 30 },
  {
    key: 'rewarded_daily_cap',
    label: 'All rewarded ads / day (UTC)',
    min: 0,
    max: 100,
    defaultValue: 5,
  },
  {
    key: 'rewarded_hourly_cap',
    label: 'All rewarded ads / hour',
    min: 0,
    max: 100,
    defaultValue: 2,
  },
  {
    key: 'rewarded_gap_seconds',
    label: 'Rewarded gap (seconds)',
    min: 0,
    max: 86400,
    defaultValue: 60,
  },
  {
    key: 'voluntary_daily_cap',
    label: 'Voluntary ads / day (UTC)',
    min: 0,
    max: 100,
    defaultValue: 3,
  },
  {
    key: 'voluntary_weekly_cap',
    label: 'Voluntary ads / week',
    min: 0,
    max: 700,
    defaultValue: 10,
  },
] as const;
export type CreditSettings = Record<(typeof creditKnobs)[number]['key'], number> & {
  interstitial_video_enabled: boolean;
};

export function validateCreditSettings(settings: CreditSettings): void {
  for (const knob of creditKnobs) {
    const value = settings[knob.key];
    if (!Number.isSafeInteger(value) || value < knob.min || value > knob.max)
      throw new Error(`${knob.label}: enter a whole number from ${knob.min} to ${knob.max}.`);
  }
  if (typeof settings.interstitial_video_enabled !== 'boolean')
    throw new Error('Interstitial video enabled must be a boolean.');
}

export interface CreditStat {
  day: string;
  reason: string;
  events: number | string;
  credits: number | string;
}
export function creditDays(rows: readonly CreditStat[]) {
  const days = new Map<
    string,
    { day: string; earned: number; spent: number; reasons: Record<string, number> }
  >();
  for (const row of rows) {
    const day = days.get(row.day) ?? { day: row.day, earned: 0, spent: 0, reasons: {} };
    if (row.reason.startsWith('ad_')) day.earned += count(row.credits);
    if (row.reason.startsWith('spend_')) day.spent += count(row.credits);
    day.reasons[row.reason] = (day.reasons[row.reason] ?? 0) + count(row.events);
    days.set(row.day, day);
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

export function rewardedCompletions(
  rows: readonly { placement: string; completed: number | string }[],
) {
  const totals = new Map<string, number>([
    ['group_create_rewarded', 0],
    ['export_rewarded', 0],
    ['quota_rewarded', 0],
    ['credit_voluntary', 0],
    ['credit_offer', 0],
  ]);
  for (const row of rows) {
    if (totals.has(row.placement) || count(row.completed) > 0)
      totals.set(row.placement, (totals.get(row.placement) ?? 0) + count(row.completed));
  }
  return [...totals].map(([placement, completed]) => ({ placement, completed }));
}

export function bannerStats(
  rows: readonly {
    day: string;
    placement: string;
    shown: number | string;
    failed: number | string;
  }[],
  todayUtc: string,
) {
  const firstDay = new Date(`${todayUtc}T00:00:00Z`);
  firstDay.setUTCDate(firstDay.getUTCDate() - 6);
  const since = firstDay.toISOString().slice(0, 10);
  return ['review_banner', 'home_banner'].map((placement) => {
    const totals = {
      placement,
      shownToday: 0,
      failedToday: 0,
      shownLast7Days: 0,
      failedLast7Days: 0,
    };
    for (const row of rows) {
      if (row.placement !== placement || row.day < since || row.day > todayUtc) continue;
      totals.shownLast7Days += count(row.shown);
      totals.failedLast7Days += count(row.failed);
      if (row.day === todayUtc) {
        totals.shownToday += count(row.shown);
        totals.failedToday += count(row.failed);
      }
    }
    return totals;
  });
}
