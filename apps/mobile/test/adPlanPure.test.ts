import { describe, expect, it } from 'vitest';
import { mergePlacements, PLACEMENT_DEFAULTS, validatePlacements } from '@waves/core';
import { adDetail, planAds, placeSlots, type PlanInput } from '../src/lib/adPlanPure';

const DAY = 86400e3;
const NOW = Date.UTC(2026, 9, 29, 12);
const base = (
  over: Partial<PlanInput> = {},
  surface: PlanInput['surface'] = 'activity',
): PlanInput => ({
  surface,
  rowCount: 300,
  listKey: '',
  profileId: 'p1',
  utcDay: '2026-10-29',
  now: NOW,
  eligibility: {
    gateEnabled: true,
    bannerEligible: true,
    isPaid: false,
    online: true,
    canRequestAds: true,
    createdAt: NOW - 200 * DAY,
    variant: 'control',
  },
  session: {
    startedAt: NOW - 600e3,
    foregroundMs: 600e3,
    sessionsToday: 1,
    sessionCap: 100,
    impressionsSession: 0,
    impressionsToday: 0,
    impressionsVisit: 0,
    lastRewardedAt: 0,
    lastFailureAt: 0,
    removeAdsTappedAt: 0,
  },
  surfaceState: {},
  config: {
    ...PLACEMENT_DEFAULTS,
    earn_seconds_per_impression: 0,
    daily_cap: 100,
    visit_cap_default: 50,
  },
  rewardedQuietSeconds: 300,
  ...over,
});
const withCfg = (c: Record<string, number>) => ({ ...base().config, ...c });

describe('planAds slots', () => {
  it('is deterministic and varies by day, list and profile', () => {
    const a = planAds(base());
    expect(planAds(base())).toEqual(a);
    expect(a.slots.length).toBe(3);
    for (const o of [{ utcDay: '2026-10-30' }, { listKey: 'g1' }, { profileId: 'p2' }]) {
      const results = [{}, o, { ...o, listKey: 'g2' }].map((x) =>
        JSON.stringify(planAds(base(x)).slots),
      );
      expect(new Set(results).size).toBeGreaterThan(1);
    }
  });
  it('keeps first and gap ranges, never at row 1 or the end', () => {
    for (let k = 0; k < 40; k++) {
      const config = {
        ...base().config,
        surfaces: {
          ...base().config.surfaces,
          activity: { ...base().config.surfaces.activity, visit_cap: 10 },
        },
      };
      const plan = planAds(base({ profileId: `p${k}`, rowCount: 100 + k, config }));
      expect(plan.slots.length).toBeGreaterThan(3);
      const [first, ...rest] = plan.slots;
      expect(first).toBeGreaterThanOrEqual(5);
      expect(first).toBeLessThanOrEqual(8);
      rest.forEach((n, i) => {
        const gap = n - plan.slots[i]!;
        expect(gap).toBeGreaterThanOrEqual(15);
        expect(gap).toBeLessThanOrEqual(20);
      });
      expect(Math.max(...plan.slots)).toBeLessThan(100 + k);
    }
  });
  it('draws light (young) accounts from the upper half and halves caps', () => {
    for (let k = 0; k < 30; k++) {
      const plan = planAds(
        base({
          profileId: `p${k}`,
          eligibility: { ...base().eligibility, createdAt: NOW - 20 * DAY },
        }),
      );
      expect(plan.slots[0]).toBeGreaterThanOrEqual(7);
      plan.slots.slice(1).forEach((n, i) => expect(n - plan.slots[i]!).toBeGreaterThanOrEqual(18));
    }
    const young = planAds(
      base({
        eligibility: { ...base().eligibility, createdAt: NOW - 20 * DAY },
        session: { ...base().session, sessionCap: 7 },
      }),
    );
    expect(young.sessionCap).toBe(4);
  });
  it('home puts one card inside the list and needs 10 groups', () => {
    const plan = planAds(base({ rowCount: 12 }, 'home_groups'));
    expect(plan.slots).toHaveLength(1);
    expect(plan.slots[0]).toBeGreaterThanOrEqual(6);
    expect(plan.slots[0]).toBeLessThanOrEqual(9);
    const short = planAds(base({ rowCount: 9 }, 'home_groups'));
    expect(short.slots).toEqual([]);
    expect(short.reason).toBe('too_short');
  });
  it('short lists: too_short under 3, footer banner for activity 3-7 rows, slots at 8+', () => {
    expect(planAds(base({ rowCount: 7 })).footerBanner).toBe(true);
    expect(planAds(base({ rowCount: 7 })).slots).toEqual([]);
    expect(planAds(base({ rowCount: 2 })).reason).toBe('too_short');
    expect(planAds(base({ rowCount: 7 }, 'friends')).reason).toBe('too_short');
    const eight = planAds(base({ rowCount: 8 }));
    expect(eight.footerBanner).toBe(false);
    expect(eight.slots.length).toBeGreaterThan(0);
  });
  it('inline surfaces return an inline banner only when allowed', () => {
    expect(planAds(base({}, 'settings')).inlineBanner).toBe(true);
    expect(planAds(base({ surfaceState: { stage: 'listening' } }, 'voice_idle')).inlineBanner).toBe(
      true,
    );
    for (const stage of ['thinking', 'review', 'done', undefined] as const) {
      expect(planAds(base({ surfaceState: { stage } }, 'voice_idle')).reason).toBe('surface_busy');
    }
  });
});

describe('planAds budget', () => {
  it('caps by session, day (local or server max) and visit; slots never exceed budget', () => {
    const s = base().session;
    expect(planAds(base({ session: { ...s, impressionsSession: 100 } })).reason).toBe('budget');
    expect(planAds(base({ session: { ...s, impressionsToday: 100 } })).reason).toBe('budget');
    expect(planAds(base({ session: { ...s, impressionsVisit: 50 } })).reason).toBe('budget');
    const plan = planAds(base({ session: { ...s, sessionCap: 2 } }));
    expect(plan.slots).toHaveLength(2);
    expect(plan.budgetLeft).toBe(2);
    expect(
      planAds(base({ session: { ...s, sessionCap: 99 } }, 'friends')).slots.length,
    ).toBeLessThanOrEqual(50);
  });
  it('visit cap per surface wins over the default', () => {
    expect(planAds(base()).slots.length).toBeLessThanOrEqual(3);
    expect(
      planAds(base({ config: { ...base().config, visit_cap_default: 50 } }, 'timeline_list'))
        .budgetLeft,
    ).toBe(2);
  });
  it('earn rate unlocks budget with foreground time; 0 means unlimited', () => {
    const config = withCfg({ earn_seconds_per_impression: 40 }) as PlanInput['config'];
    const at = (sec: number) =>
      planAds(base({ config, session: { ...base().session, foregroundMs: sec * 1000 } }))
        .budgetLeft;
    expect(at(20)).toBe(1);
    expect(at(60)).toBe(2);
    expect(at(140)).toBe(3);
  });
  it('halves the session cap after many sessions today', () => {
    const s = base().session;
    expect(planAds(base({ session: { ...s, sessionCap: 7, sessionsToday: 4 } })).sessionCap).toBe(
      4,
    );
    expect(planAds(base({ session: { ...s, sessionCap: 7, sessionsToday: 3 } })).sessionCap).toBe(
      7,
    );
  });
  it('draws the session cap from the configured range when the caller has none', () => {
    const cap = planAds(base({ session: { ...base().session, sessionCap: null } })).sessionCap;
    expect(cap).toBeGreaterThanOrEqual(4);
    expect(cap).toBeLessThanOrEqual(7);
  });
  it('jitters the dwell inside its range', () => {
    for (let k = 0; k < 20; k++) {
      const d = planAds(base({ profileId: `p${k}` })).requestDelayMs;
      expect(d).toBeGreaterThanOrEqual(2000);
      expect(d).toBeLessThanOrEqual(6000);
    }
  });
});

describe('planAds quiet windows and eligibility', () => {
  const s = base().session;
  it('quiet windows and backoff', () => {
    expect(planAds(base({ session: { ...s, lastRewardedAt: NOW - 100e3 } })).reason).toBe(
      'rewarded_quiet',
    );
    expect(planAds(base({ session: { ...s, lastRewardedAt: NOW - 301e3 } })).reason).toBe('ok');
    expect(planAds(base({ session: { ...s, removeAdsTappedAt: NOW - 3600e3 } })).reason).toBe(
      'remove_ads_quiet',
    );
    expect(planAds(base({ session: { ...s, removeAdsTappedAt: NOW - 25 * 3600e3 } })).reason).toBe(
      'ok',
    );
    expect(planAds(base({ session: { ...s, lastFailureAt: NOW - 100e3 } })).reason).toBe('backoff');
    expect(planAds(base({ session: { ...s, foregroundMs: 5000 } })).reason).toBe('session_grace');
  });
  it('surface busy states', () => {
    for (const k of [
      'keyboardOpen',
      'selectMode',
      'sheetOpen',
      'undoPending',
      'mapMode',
    ] as const) {
      const plan = planAds(base({ surfaceState: { [k]: true } }));
      expect(plan.reason).toBe('surface_busy');
      expect(plan.slots).toEqual([]);
    }
    const off = mergePlacements({ surfaces: { activity: { enabled: false } } });
    expect(planAds(base({ config: { ...base().config, surfaces: off.surfaces } })).reason).toBe(
      'disabled',
    );
  });
  it('is empty for paid, trial (gate off), banner-ineligible, offline, no consent, no variant', () => {
    const e = base().eligibility;
    for (const o of [
      { isPaid: true },
      { gateEnabled: false },
      { bannerEligible: false },
      { online: false },
      { canRequestAds: false },
      { variant: null },
    ]) {
      const plan = planAds(base({ eligibility: { ...e, ...o } }));
      expect(plan.reason).toBe('ineligible');
      expect(plan.slots).toEqual([]);
      expect(plan.inlineBanner || plan.footerBanner).toBe(false);
    }
  });
});

describe('placeSlots', () => {
  const feed = (rows: number, headerAt: number[] = []) => {
    const out: { kind: string; key: string }[] = [];
    for (let n = 1; n <= rows; n++) {
      if (headerAt.includes(n)) out.push({ kind: 'header', key: `h${n}` });
      out.push({ kind: 'row', key: `r${n}` });
    }
    return out;
  };
  const adsAfter = (items: { kind: string; key: string }[]) =>
    items.flatMap((x, i) => (x.kind === 'ad' ? [items[i - 1]!.key] : []));
  it('inserts after the n-th row with stable keys', () => {
    const out = placeSlots(feed(20), [5, 12]);
    expect(adsAfter(out)).toEqual(['r5', 'r12']);
    expect(out.filter((x) => x.kind === 'ad').map((x) => x.key)).toEqual(['ad-5', 'ad-12']);
  });
  it('shifts off blocked rows up to +3 then drops', () => {
    expect(adsAfter(placeSlots(feed(20), [5], new Set([5, 6])))).toEqual(['r7']);
    expect(adsAfter(placeSlots(feed(20), [5], new Set([5, 6, 7, 8])))).toEqual([]);
  });
  it('keeps the minimum gap when an earlier slot shifts', () => {
    const rows = feed(40);
    const out = placeSlots(
      rows,
      [8, 23],
      new Set([8, 9, 10]),
      { row: 'row', header: 'header' },
      15,
    );
    expect(adsAfter(out)).toEqual(['r11', 'r26']);
  });
  it('never opens a section with an ad and keeps a row below', () => {
    expect(adsAfter(placeSlots(feed(20, [5]), [5]))).toEqual(['r6']);
    expect(adsAfter(placeSlots(feed(6), [6]))).toEqual([]);
  });
});

describe('placements config', () => {
  it('merges defaults and ignores junk; bad pairs reset to defaults', () => {
    expect(mergePlacements(undefined)).toEqual(PLACEMENT_DEFAULTS);
    expect(mergePlacements('x')).toEqual(PLACEMENT_DEFAULTS);
    const m = mergePlacements({
      daily_cap: 30,
      nope: 1,
      dwell_min_seconds: 50,
      dwell_max_seconds: 10,
      session_cap_min: 'a',
    });
    expect(m.daily_cap).toBe(30);
    expect(m.dwell_min_seconds).toBe(2);
    expect(m.dwell_max_seconds).toBe(6);
    expect(m.session_cap_min).toBe(4);
    expect(m).not.toHaveProperty('nope');
  });
  it('Home keeps its 10-group floor however the config is set', () => {
    expect(
      mergePlacements({ surfaces: { home_groups: { min_rows: 5 } } }).surfaces.home_groups.min_rows,
    ).toBe(10);
    expect(validatePlacements({ surfaces: { home_groups: { min_rows: 5 } } })).not.toBeNull();
    expect(validatePlacements({ surfaces: { home_groups: { min_rows: 12 } } })).toBeNull();
    const cfg = { ...base().config };
    cfg.surfaces = { ...cfg.surfaces, home_groups: { ...cfg.surfaces.home_groups, min_rows: 3 } };
    expect(planAds(base({ rowCount: 9, config: cfg }, 'home_groups')).reason).toBe('too_short');
  });
  it('a surface with min > max falls back to its defaults', () => {
    const m = mergePlacements({ surfaces: { friends: { gap_min: 30, gap_max: 12 } } });
    expect(m.surfaces.friends.gap_min).toBe(15);
    expect(m.surfaces.friends.gap_max).toBe(12 > 0 ? 20 : 0);
  });
  it('strict validation rejects unknown keys, ranges and min > max', () => {
    expect(validatePlacements({})).toBeNull();
    expect(
      validatePlacements({ daily_cap: 20, surfaces: { friends: { gap_min: 12, gap_max: 30 } } }),
    ).toBeNull();
    expect(validatePlacements({ bogus: 1 })).toMatch(/Unknown/);
    expect(validatePlacements({ daily_cap: 101 })).not.toBeNull();
    expect(validatePlacements({ session_cap_min: 9, session_cap_max: 3 })).not.toBeNull();
    expect(validatePlacements({ surfaces: { nope: {} } })).not.toBeNull();
    expect(validatePlacements({ surfaces: { friends: { gap_min: 9 } } })).not.toBeNull();
    expect(validatePlacements({ surfaces: { friends: { gap_max: 41 } } })).not.toBeNull();
    expect(validatePlacements({ surfaces: { friends: { first_min: 2 } } })).not.toBeNull();
    expect(
      validatePlacements({ surfaces: { friends: { gap_min: 30, gap_max: 20 } } }),
    ).not.toBeNull();
    expect(
      validatePlacements({ surfaces: { friends: { min_rows: 8, first_min: 8 } } }),
    ).not.toBeNull();
    expect(validatePlacements({ surfaces: { friends: { wat: 1 } } })).not.toBeNull();
  });
});

describe('adDetail', () => {
  it('writes k=v pairs without separators in values and caps length', () => {
    expect(adDetail({ s: 'activity', i: 2, x: undefined, v: 'a;b=c' })).toBe(
      's=activity;i=2;v=abc',
    );
    expect(adDetail({ s: 'x'.repeat(500) }).length).toBe(200);
  });
});
