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
