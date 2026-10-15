/**
 * The activation and retention targets, and what colour a reading earns.
 *
 * Pure and dependency-free on purpose: the thresholds are product decisions,
 * and the one thing worth a unit test on this page is that a value lands on the
 * right side of them. `lib/data` cannot be imported by a test (it is
 * `server-only`), so none of this lives there.
 *
 * Ratios arrive from Postgres as fractions (0.6 is 60%). The cost is rupees.
 */

export type KpiStatus = 'ok' | 'warn' | 'bad' | 'unknown';

export interface KpiThreshold {
  /** Which way is better. */
  better: 'higher' | 'lower';
  /** Meeting this is `ok`. */
  target: number;
  /** Past this, the other way, is `bad`. Between target and warn is `warn`. */
  warn: number;
}

export type KpiKey =
  | 'install_to_registration'
  | 'registration_to_activation'
  | 'd1'
  | 'd7'
  | 'd30'
  | 'invite_to_registration'
  | 'crash_free_sessions'
  | 'cost_per_activated_user';

export const KPI_THRESHOLDS: Record<KpiKey, KpiThreshold> = {
  install_to_registration: { better: 'higher', target: 0.6, warn: 0.4 },
  registration_to_activation: { better: 'higher', target: 0.5, warn: 0.3 },
  d1: { better: 'higher', target: 0.4, warn: 0.25 },
  d7: { better: 'higher', target: 0.25, warn: 0.15 },
  d30: { better: 'higher', target: 0.15, warn: 0.1 },
  invite_to_registration: { better: 'higher', target: 0.2, warn: 0.1 },
  crash_free_sessions: { better: 'higher', target: 0.995, warn: 0.99 },
  // Rupees. Lower is better: at or under 100 is ok, over 150 is bad.
  cost_per_activated_user: { better: 'lower', target: 100, warn: 150 },
};

/**
 * `ok` at the target or better, `bad` strictly past the warning line, `warn`
 * in between. A missing or non-finite reading is `unknown`, never `bad`: a
 * cohort too young to measure is not a failure.
 */
export function kpiStatus(value: number | null | undefined, threshold: KpiThreshold): KpiStatus {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'unknown';
  if (threshold.better === 'higher') {
    if (value >= threshold.target) return 'ok';
    if (value < threshold.warn) return 'bad';
    return 'warn';
  }
  if (value <= threshold.target) return 'ok';
  if (value > threshold.warn) return 'bad';
  return 'warn';
}

/** The ratio from raw counts, or null when there is nothing to divide by. */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** `0.4213` as `42.1%`; null as an en dash. */
export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${(value * 100).toFixed(1)}%`;
}
