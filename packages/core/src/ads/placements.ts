/**
 * Banner/native ad placement config ("ad intelligence"). One jsonb on
 * `ad_reward_settings.placements`; every key is optional and falls back to
 * PLACEMENT_DEFAULTS, so a client works against a database without the column.
 * Shared by the phone (planner), the admin form and tests. The SQL function
 * `waves_validate_placements` mirrors `validatePlacements`.
 */

export const AD_SURFACES = [
  'home_groups',
  'groups_all',
  'group_expenses',
  'activity',
  'timeline_list',
  'friends',
  'voice_idle',
  'settings',
] as const;
export type AdSurface = (typeof AD_SURFACES)[number];

export type GlobalKey =
  | 'session_cap_min'
  | 'session_cap_max'
  | 'daily_cap'
  | 'session_idle_reset_seconds'
  | 'session_grace_seconds'
  | 'earn_seconds_per_impression'
  | 'dwell_min_seconds'
  | 'dwell_max_seconds'
  | 'visit_cap_default'
  | 'failure_backoff_seconds'
  | 'remove_ads_quiet_hours'
  | 'light_tenure_days'
  | 'light_sessions_per_day';
export interface GlobalKnob {
  key: GlobalKey;
  label: string;
  min: number;
  max: number;
  def: number;
}
export const GLOBAL_KNOBS: readonly GlobalKnob[] = [
  { key: 'session_cap_min', label: 'Ads per session, min', min: 0, max: 30, def: 4 },
  { key: 'session_cap_max', label: 'Ads per session, max', min: 0, max: 30, def: 7 },
  { key: 'daily_cap', label: 'Ads per person per UTC day', min: 0, max: 100, def: 20 },
  {
    key: 'session_idle_reset_seconds',
    label: 'Idle seconds that start a new session',
    min: 300,
    max: 7200,
    def: 1800,
  },
  {
    key: 'session_grace_seconds',
    label: 'No ads in the first seconds of a session',
    min: 0,
    max: 300,
    def: 20,
  },
  {
    key: 'earn_seconds_per_impression',
    label: 'Seconds in app to unlock one more ad (0 = no limit)',
    min: 0,
    max: 600,
    def: 40,
  },
  {
    key: 'dwell_min_seconds',
    label: 'Seconds on a screen before first request, min',
    min: 0,
    max: 60,
    def: 2,
  },
  {
    key: 'dwell_max_seconds',
    label: 'Seconds on a screen before first request, max',
    min: 0,
    max: 60,
    def: 6,
  },
  { key: 'visit_cap_default', label: 'Ads per screen visit', min: 1, max: 10, def: 3 },
  {
    key: 'failure_backoff_seconds',
    label: 'Pause after an ad fails to load (seconds)',
    min: 60,
    max: 3600,
    def: 600,
  },
  {
    key: 'remove_ads_quiet_hours',
    label: 'Quiet hours after "Remove ads" is tapped',
    min: 0,
    max: 168,
    def: 24,
  },
  {
    key: 'light_tenure_days',
    label: 'Accounts younger than this get fewer ads (days)',
    min: 0,
    max: 365,
    def: 30,
  },
  {
    key: 'light_sessions_per_day',
    label: 'Sessions a day before the session cap halves',
    min: 0,
    max: 50,
    def: 4,
  },
];

export interface SurfaceConfig {
  enabled: boolean;
  format: 'native' | 'inline_banner';
  min_rows: number | null;
  first_min: number | null;
  first_max: number | null;
  gap_min: number | null;
  gap_max: number | null;
  visit_cap: number | null;
  footer_banner_min_rows: number | null;
}
export interface PlacementConfig extends Record<GlobalKey, number> {
  surfaces: Record<AdSurface, SurfaceConfig>;
}

const list = (visit_cap: number, extra: Partial<SurfaceConfig> = {}): SurfaceConfig => ({
  enabled: true,
  format: 'native',
  min_rows: 8,
  first_min: 5,
  first_max: 8,
  gap_min: 15,
  gap_max: 20,
  visit_cap,
  footer_banner_min_rows: null,
  ...extra,
});
const inline = (): SurfaceConfig => ({
  enabled: true,
  format: 'inline_banner',
  min_rows: null,
  first_min: null,
  first_max: null,
  gap_min: null,
  gap_max: null,
  visit_cap: 1,
  footer_banner_min_rows: null,
});
export const SURFACE_DEFAULTS: Record<AdSurface, SurfaceConfig> = {
  // One card inside the list (Home needs >= 10 groups), never at the end.
  home_groups: list(1, { min_rows: 10, first_min: 6, first_max: 9, gap_min: null, gap_max: null }),
  groups_all: list(3),
  group_expenses: list(3),
  activity: list(3, { footer_banner_min_rows: 3 }),
  timeline_list: list(2),
  friends: list(2),
  voice_idle: inline(),
  settings: inline(),
};

/** Numeric surface fields and their allowed ranges (server validation). */
export const SURFACE_RANGES: Record<string, [number, number]> = {
  min_rows: [1, 200],
  first_min: [3, 100],
  first_max: [3, 100],
  gap_min: [10, 40],
  gap_max: [10, 40],
  visit_cap: [1, 10],
  footer_banner_min_rows: [1, 200],
};

export const PLACEMENT_DEFAULTS: PlacementConfig = {
  ...Object.fromEntries(GLOBAL_KNOBS.map((k) => [k.key, k.def])),
  surfaces: SURFACE_DEFAULTS,
} as PlacementConfig;

const PAIRS: [GlobalKey, GlobalKey][] = [
  ['session_cap_min', 'session_cap_max'],
  ['dwell_min_seconds', 'dwell_max_seconds'],
];
const inRange = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Surface-level consistency; returns an error text or null. */
function surfaceProblem(name: string, s: SurfaceConfig): string | null {
  if (s.format !== 'native') return null;
  if (s.first_min != null && s.first_max != null && s.first_min > s.first_max)
    return `${name}: first position min is above max.`;
  if (s.gap_min != null && s.gap_max != null && s.gap_min > s.gap_max)
    return `${name}: gap min is above max.`;
  // Spec says first_max + 1, but its own defaults (8 rows, first 5-8) break that.
  if (s.first_min != null && s.min_rows != null && s.min_rows < s.first_min + 1)
    return `${name}: min rows must be at least first position min + 1.`;
  return null;
}

/**
 * Tolerant read of whatever the server sent: bad/missing values fall back to
 * defaults (per key, and per min/max pair), unknown keys are ignored. Never throws.
 */
export function mergePlacements(raw: unknown): PlacementConfig {
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  for (const k of GLOBAL_KNOBS)
    out[k.key] = inRange(src[k.key], k.min, k.max) ? (src[k.key] as number) : k.def;
  for (const [lo, hi] of PAIRS) {
    if ((out[lo] as number) > (out[hi] as number)) {
      out[lo] = PLACEMENT_DEFAULTS[lo] as number;
      out[hi] = PLACEMENT_DEFAULTS[hi] as number;
    }
  }
  const rawSurfaces =
    src.surfaces && typeof src.surfaces === 'object'
      ? (src.surfaces as Record<string, unknown>)
      : {};
  const surfaces = {} as Record<AdSurface, SurfaceConfig>;
  for (const name of AD_SURFACES) {
    const def = SURFACE_DEFAULTS[name];
    const r = rawSurfaces[name];
    const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
    const s: SurfaceConfig = { ...def };
    if (typeof o.enabled === 'boolean') s.enabled = o.enabled;
    for (const [field, [lo, hi]] of Object.entries(SURFACE_RANGES)) {
      // Fields a surface does not use (null by default) stay null.
      if ((def as unknown as Record<string, unknown>)[field] != null && inRange(o[field], lo, hi))
        (s as unknown as Record<string, unknown>)[field] = o[field];
    }
    surfaces[name] = surfaceProblem(name, s) ? { ...def, enabled: s.enabled } : s;
  }
  return { ...out, surfaces } as PlacementConfig;
}

/** Strict check for the admin form: returns the first problem, or null. */
export function validatePlacements(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return 'Placement settings must be an object.';
  const src = raw as Record<string, unknown>;
  const known = new Map<string, GlobalKnob>(GLOBAL_KNOBS.map((k) => [k.key, k]));
  for (const [key, value] of Object.entries(src)) {
    if (key === 'surfaces') continue;
    const knob = known.get(key);
    if (!knob) return `Unknown setting "${key}".`;
    if (!inRange(value, knob.min, knob.max))
      return `${knob.label}: enter a whole number from ${knob.min} to ${knob.max}.`;
  }
  for (const [lo, hi] of PAIRS) {
    const a = src[lo] ?? PLACEMENT_DEFAULTS[lo];
    const b = src[hi] ?? PLACEMENT_DEFAULTS[hi];
    if ((a as number) > (b as number)) return `${lo} must not be above ${hi}.`;
  }
  const surfaces = src.surfaces;
  if (surfaces === undefined) return null;
  if (!surfaces || typeof surfaces !== 'object' || Array.isArray(surfaces))
    return 'surfaces must be an object.';
  for (const [name, value] of Object.entries(surfaces as Record<string, unknown>)) {
    if (!(AD_SURFACES as readonly string[]).includes(name)) return `Unknown surface "${name}".`;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return `${name}: must be an object.`;
    const o = value as Record<string, unknown>;
    const merged: SurfaceConfig = { ...SURFACE_DEFAULTS[name as AdSurface] };
    for (const [field, v] of Object.entries(o)) {
      if (field === 'enabled') {
        if (typeof v !== 'boolean') return `${name}: enabled must be true or false.`;
        merged.enabled = v;
      } else if (field in SURFACE_RANGES) {
        const [lo, hi] = SURFACE_RANGES[field] as [number, number];
        if (!inRange(v, lo, hi))
          return `${name}: ${field} must be a whole number from ${lo} to ${hi}.`;
        (merged as unknown as Record<string, unknown>)[field] = v;
      } else return `${name}: unknown field "${field}".`;
    }
    const problem = surfaceProblem(name, merged);
    if (problem) return problem;
  }
  return null;
}
