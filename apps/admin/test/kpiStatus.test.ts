import { describe, expect, it } from 'vitest';

import { KPI_THRESHOLDS, kpiStatus, percent, ratio, type KpiKey } from '../src/lib/kpiStatus';

const status = (key: KpiKey, value: number | null) => kpiStatus(value, KPI_THRESHOLDS[key]);

describe('higher is better', () => {
  it('install to registration: ok from 60%, bad under 40%', () => {
    expect(status('install_to_registration', 0.6)).toBe('ok');
    expect(status('install_to_registration', 0.85)).toBe('ok');
    expect(status('install_to_registration', 0.59)).toBe('warn');
    expect(status('install_to_registration', 0.4)).toBe('warn');
    expect(status('install_to_registration', 0.399)).toBe('bad');
  });

  it('registration to activation: ok from 50%, bad under 30%', () => {
    expect(status('registration_to_activation', 0.5)).toBe('ok');
    expect(status('registration_to_activation', 0.3)).toBe('warn');
    expect(status('registration_to_activation', 0.29)).toBe('bad');
  });

  it('retention: D1 40/25, D7 25/15, D30 15/10', () => {
    expect(status('d1', 0.4)).toBe('ok');
    expect(status('d1', 0.25)).toBe('warn');
    expect(status('d1', 0.249)).toBe('bad');
    expect(status('d7', 0.25)).toBe('ok');
    expect(status('d7', 0.15)).toBe('warn');
    expect(status('d7', 0.149)).toBe('bad');
    expect(status('d30', 0.15)).toBe('ok');
    expect(status('d30', 0.1)).toBe('warn');
    expect(status('d30', 0.099)).toBe('bad');
  });

  it('invite to registration: ok from 20%, bad under 10%', () => {
    expect(status('invite_to_registration', 0.2)).toBe('ok');
    expect(status('invite_to_registration', 0.1)).toBe('warn');
    expect(status('invite_to_registration', 0.09)).toBe('bad');
  });

  it('crash-free sessions: ok from 99.5%, bad under 99%', () => {
    expect(status('crash_free_sessions', 0.995)).toBe('ok');
    expect(status('crash_free_sessions', 0.992)).toBe('warn');
    expect(status('crash_free_sessions', 0.99)).toBe('warn');
    expect(status('crash_free_sessions', 0.989)).toBe('bad');
  });
});

describe('lower is better', () => {
  it('cost per activated user: ok up to Rs 100, bad over Rs 150', () => {
    expect(status('cost_per_activated_user', 0)).toBe('ok');
    expect(status('cost_per_activated_user', 100)).toBe('ok');
    expect(status('cost_per_activated_user', 100.01)).toBe('warn');
    expect(status('cost_per_activated_user', 150)).toBe('warn');
    expect(status('cost_per_activated_user', 150.01)).toBe('bad');
  });
});

describe('no reading', () => {
  it('is unknown, never bad', () => {
    expect(status('d30', null)).toBe('unknown');
    expect(kpiStatus(undefined, KPI_THRESHOLDS.d1)).toBe('unknown');
    expect(kpiStatus(Number.NaN, KPI_THRESHOLDS.d1)).toBe('unknown');
  });
});

describe('ratio and percent', () => {
  it('divides, and refuses to divide by nothing', () => {
    expect(ratio(1, 4)).toBe(0.25);
    expect(ratio(0, 5)).toBe(0);
    expect(ratio(3, 0)).toBeNull();
  });

  it('formats a fraction as a percentage', () => {
    expect(percent(0.4213)).toBe('42.1%');
    expect(percent(1)).toBe('100.0%');
    expect(percent(null)).toBe('–');
  });
});
