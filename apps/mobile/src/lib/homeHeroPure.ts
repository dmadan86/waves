/**
 * Which scenic photograph Home's header wears, from the phone's clock. Pure, so
 * the rule is tested without a clock, a device or a native module.
 *
 *   05:00–09:00 morning · 09:00–12:00 late-morning · 12:00–16:00 afternoon ·
 *   16:00–18:00 evening · 18:00–20:00 sunset · 20:00–05:00 night
 *
 * Two variants sit over the daytime slots, and only when the context is
 * reliable:
 *   rainy   never inferred (the app has no weather source); worn only when a
 *           caller passes `weather: 'rainy'`, for daytime slots.
 *   season  spring or autumn, for late-morning and afternoon only, and only
 *           when the device region says which hemisphere it is in. Northern:
 *           spring Mar–Apr, autumn Oct–Nov; southern swaps them. Regions that
 *           are tropical, equatorial or unknown get no season.
 */

export type HomeHero =
  | 'morning'
  | 'late-morning'
  | 'afternoon'
  | 'evening'
  | 'sunset'
  | 'night'
  | 'rainy'
  | 'autumn'
  | 'spring';

export type Hemisphere = 'north' | 'south';

/** Hours (local) at which the time-of-day slot changes. */
export const HERO_BOUNDARY_HOURS = [5, 9, 12, 16, 18, 20] as const;

/** Countries lying wholly or overwhelmingly south of the equator, with real seasons. */
const SOUTHERN = new Set([
  'AU',
  'NZ',
  'ZA',
  'AR',
  'CL',
  'UY',
  'PY',
  'BO',
  'BR',
  'LS',
  'SZ',
  'BW',
  'NA',
]);

/** Temperate northern countries whose spring and autumn match the pictures.
 *  Tropical and monsoon regions (India, the Gulf, South-East Asia) are left
 *  out on purpose: a spring blossom in a Mumbai March would be wrong. */
const NORTHERN = new Set([
  'US',
  'CA',
  'GB',
  'IE',
  'FR',
  'DE',
  'ES',
  'IT',
  'PT',
  'NL',
  'BE',
  'LU',
  'CH',
  'AT',
  'SE',
  'NO',
  'DK',
  'FI',
  'IS',
  'PL',
  'CZ',
  'SK',
  'HU',
  'RO',
  'BG',
  'GR',
  'HR',
  'SI',
  'RS',
  'UA',
  'LT',
  'LV',
  'EE',
  'JP',
  'KR',
  'CN',
  'TR',
]);

export function hemisphereForRegion(regionCode: string | null | undefined): Hemisphere | null {
  if (!regionCode) return null;
  const code = regionCode.trim().toUpperCase();
  if (SOUTHERN.has(code)) return 'south';
  if (NORTHERN.has(code)) return 'north';
  return null;
}

export type HomeHeroSlot =
  'morning' | 'late-morning' | 'afternoon' | 'evening' | 'sunset' | 'night';

export function slotFor(date: Date): HomeHeroSlot {
  const h = date.getHours();
  if (h >= 5 && h < 9) return 'morning';
  if (h >= 9 && h < 12) return 'late-morning';
  if (h >= 12 && h < 16) return 'afternoon';
  if (h >= 16 && h < 18) return 'evening';
  if (h >= 18 && h < 20) return 'sunset';
  return 'night';
}

/** The season picture for a month (0-11) in a hemisphere, if one applies. */
export function seasonFor(month: number, hemisphere: Hemisphere): 'spring' | 'autumn' | null {
  const spring = hemisphere === 'north' ? [2, 3] : [9, 10];
  const autumn = hemisphere === 'north' ? [9, 10] : [2, 3];
  if (spring.includes(month)) return 'spring';
  if (autumn.includes(month)) return 'autumn';
  return null;
}

export function selectHomeHero(
  date: Date,
  options: { regionCode?: string | null; weather?: 'rainy' | null } = {},
): HomeHero {
  const slot = slotFor(date);
  const daytime = slot === 'morning' || slot === 'late-morning' || slot === 'afternoon';
  if (daytime && options.weather === 'rainy') return 'rainy';
  if (slot === 'late-morning' || slot === 'afternoon') {
    const hemisphere = hemisphereForRegion(options.regionCode);
    const season = hemisphere ? seasonFor(date.getMonth(), hemisphere) : null;
    if (season) return season;
  }
  return slot;
}

/** Milliseconds until the next slot boundary (never less than one second). */
export function msUntilNextBoundary(now: Date): number {
  for (const hour of HERO_BOUNDARY_HOURS) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour);
    if (at.getTime() > now.getTime()) return Math.max(1000, at.getTime() - now.getTime());
  }
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    HERO_BOUNDARY_HOURS[0],
  );
  return Math.max(1000, next.getTime() - now.getTime());
}

/** The Background picker's old scene names, mapped to the new photographs.
 *  Winter has no counterpart, so it falls back to the clock. */
export function heroForPickedScene(scene: string | null | undefined): HomeHero | null {
  switch (scene) {
    case 'morning':
    case 'afternoon':
    case 'sunset':
    case 'evening':
    case 'night':
      return scene;
    default:
      return null;
  }
}
