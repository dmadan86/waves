/**
 * The banner/native "ad intelligence" planner. Pure and synchronous: given a
 * screen, its row count and the person's session state it says where passive ads
 * may go on this visit and when they may be requested. No React Native imports.
 * Owner rules it enforces: Free only, banners after the account is old enough,
 * never while a sheet/keyboard/select mode/Undo is up, spacing from config.
 */
import { HOME_MIN_ROWS, type AdSurface, type PlacementConfig } from '@waves/core';

export type PlanReason =
  | 'ok'
  | 'ineligible'
  | 'surface_busy'
  | 'rewarded_quiet'
  | 'remove_ads_quiet'
  | 'backoff'
  | 'session_grace'
  | 'budget'
  | 'too_short'
  | 'disabled';

export interface PlanInput {
  surface: AdSurface;
  /** Real rows, headers excluded. */
  rowCount: number;
  /** '' or the group id. */
  listKey: string;
  profileId: string;
  /** 'YYYY-MM-DD' (UTC). */
  utcDay: string;
  now: number;
  eligibility: {
    gateEnabled: boolean;
    bannerEligible: boolean;
    isPaid: boolean;
    online: boolean;
    canRequestAds: boolean;
    createdAt: number | null;
    variant: string | null;
  };
  session: {
    startedAt: number;
    foregroundMs: number;
    sessionsToday: number;
    sessionCap: number | null;
    impressionsSession: number;
    impressionsToday: number;
    impressionsVisit: number;
    lastRewardedAt: number;
    lastFailureAt: number;
    removeAdsTappedAt: number;
  };
  surfaceState: {
    keyboardOpen?: boolean;
    selectMode?: boolean;
    sheetOpen?: boolean;
    undoPending?: boolean;
    stage?: 'listening' | 'thinking' | 'review' | 'done';
    mapMode?: boolean;
  };
  config: PlacementConfig;
  rewardedQuietSeconds: number;
  /** Tests only. */
  seedSalt?: number;
}

export interface Plan {
  /** Insert an ad after the n-th real row (1-based), ascending. */
  slots: number[];
  footerBanner: boolean;
  inlineBanner: boolean;
  requestDelayMs: number;
  budgetLeft: number;
  sessionCap: number;
  /** Drawn gaps for logging. */
  reason: PlanReason;
}

export function fnv1a(seed: string): number {
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193);
  return state >>> 0;
}
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
const uniformInt = (rng: () => number, lo: number, hi: number) =>
  lo + Math.floor(rng() * (hi - lo + 1));

const empty = (reason: PlanReason, sessionCap = 0): Plan => ({
  slots: [],
  footerBanner: false,
  inlineBanner: false,
  requestDelayMs: 0,
  budgetLeft: 0,
  sessionCap,
  reason,
});

export function planAds(i: PlanInput): Plan {
  const c = i.config;
  const s = c.surfaces[i.surface];
  if (!s?.enabled) return empty('disabled');
  const e = i.eligibility;
  if (
    !e.gateEnabled ||
    !e.bannerEligible ||
    e.isPaid ||
    !e.online ||
    !e.canRequestAds ||
    e.variant == null
  )
    return empty('ineligible');
  const st = i.surfaceState;
  if (
    st.keyboardOpen ||
    st.selectMode ||
    st.sheetOpen ||
    st.undoPending ||
    st.mapMode ||
    (i.surface === 'voice_idle' && st.stage !== 'listening')
  )
    return empty('surface_busy');
  const q = i.session;
  if (i.now - q.lastRewardedAt < i.rewardedQuietSeconds * 1000) return empty('rewarded_quiet');
  if (i.now < q.removeAdsTappedAt + c.remove_ads_quiet_hours * 3600e3)
    return empty('remove_ads_quiet');
  if (i.now - q.lastFailureAt < c.failure_backoff_seconds * 1000) return empty('backoff');
  const fgSec = q.foregroundMs / 1000;
  if (fgSec < c.session_grace_seconds) return empty('session_grace');

  const rng = mulberry32(
    (fnv1a(`${i.profileId}|${i.utcDay}|${i.surface}|${i.listKey}`) ^ (i.seedSalt ?? 0)) >>> 0,
  );
  const sessionRng = mulberry32(fnv1a(`${i.profileId}|${i.utcDay}|session|${q.startedAt}`));
  const light = e.createdAt != null && i.now - e.createdAt < c.light_tenure_days * 86400e3;
  // Drawn even when the caller has one, so the stream is the same either way.
  const drawn = uniformInt(sessionRng, c.session_cap_min, c.session_cap_max);
  let sessionCap = q.sessionCap ?? drawn;
  if (light) sessionCap = Math.ceil(sessionCap / 2);
  if (c.light_sessions_per_day > 0 && q.sessionsToday >= c.light_sessions_per_day)
    sessionCap = Math.ceil(sessionCap / 2);
  const dailyCap = light ? Math.ceil(c.daily_cap / 2) : c.daily_cap;
  const earned =
    c.earn_seconds_per_impression === 0
      ? Infinity
      : 1 +
        Math.floor(Math.max(0, fgSec - c.session_grace_seconds) / c.earn_seconds_per_impression);
  const visitCap = s.visit_cap ?? c.visit_cap_default;
  const budgetLeft = Math.min(
    sessionCap - q.impressionsSession,
    dailyCap - q.impressionsToday,
    earned - q.impressionsSession,
    visitCap - q.impressionsVisit,
  );
  if (budgetLeft <= 0) return empty('budget', sessionCap);

  const dwell = uniformInt(rng, c.dwell_min_seconds, c.dwell_max_seconds) * (light ? 1.5 : 1);
  const plan: Plan = {
    slots: [],
    footerBanner: false,
    inlineBanner: false,
    requestDelayMs: dwell * 1000,
    budgetLeft,
    sessionCap,
    reason: 'ok',
  };
  if (s.format === 'inline_banner') {
    plan.inlineBanner = true;
    return plan;
  }
  const minRows = Math.max(s.min_rows ?? 0, i.surface === 'home_groups' ? HOME_MIN_ROWS : 0);
  if (i.rowCount < minRows) {
    if (s.footer_banner_min_rows != null && i.rowCount >= s.footer_banner_min_rows) {
      plan.footerBanner = true;
      return plan;
    }
    plan.reason = 'too_short';
    return plan;
  }
  // Light accounts draw from the upper half of each range.
  const draw = (lo: number, hi: number) =>
    light ? uniformInt(rng, Math.ceil((lo + hi) / 2), hi) : uniformInt(rng, lo, hi);
  let n = draw(s.first_min ?? 5, s.first_max ?? 8);
  // n < rowCount keeps at least one row below the ad.
  while (n < i.rowCount && plan.slots.length < budgetLeft) {
    plan.slots.push(n);
    if (s.gap_min == null || s.gap_max == null) break;
    n += draw(s.gap_min, s.gap_max);
  }
  return plan;
}

export interface AdItem {
  kind: 'ad';
  key: string;
  slot: number;
}
/**
 * Inserts an ad after the n-th row item (`kinds` names the row and header kinds). A slot whose row is blocked (selected,
 * pending Undo, above a CTA) or is the first row under a header shifts down up to
 * 3 rows, else is dropped. `blocked` holds 1-based row numbers.
 */
export function placeSlots<T extends { kind: string }>(
  items: readonly T[],
  slots: readonly number[],
  blocked: ReadonlySet<number> = new Set(),
  kinds: { row: string; header: string } = { row: 'row', header: 'header' },
  minGap = 0,
): (T | AdItem)[] {
  const rowCount = items.filter((x) => x.kind === kinds.row).length;
  const firstUnderHeader = new Set<number>();
  let row = 0;
  let afterHeader = false;
  for (const it of items) {
    if (it.kind === kinds.header) afterHeader = true;
    else if (it.kind === kinds.row) {
      row++;
      if (afterHeader) firstUnderHeader.add(row);
      afterHeader = false;
    }
  }
  const final: number[] = [];
  for (const slot of slots) {
    for (let n = slot; n <= slot + 3 && n < rowCount; n++) {
      const prev = final[final.length - 1];
      if (blocked.has(n) || firstUnderHeader.has(n) || (prev != null && n - prev < minGap))
        continue;
      final.push(n);
      break;
    }
  }
  const out: (T | AdItem)[] = [];
  row = 0;
  for (const it of items) {
    out.push(it);
    if (it.kind === kinds.row && final.includes(++row))
      out.push({ kind: 'ad', key: `ad-${row}`, slot: row });
  }
  return out;
}

/** `k=v;` pairs for ad_events.detail (<= 200 chars, no PII). */
export function adDetail(parts: Record<string, string | number | null | undefined>): string {
  return Object.entries(parts)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${String(v).replace(/[;=]/g, '')}`)
    .join(';')
    .slice(0, 200);
}

export function tenureBucket(createdAt: number | null, now: number): string {
  if (createdAt == null) return 'na';
  const days = (now - createdAt) / 86400e3;
  return days < 30 ? '15-30' : days < 90 ? '30-90' : '90+';
}
