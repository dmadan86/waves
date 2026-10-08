/**
 * Which scene the dashboard's hero wears, from the clock, and what each scene
 * is made of. The hero is drawn in layers (`components/home/HeroScene`) — a sky,
 * two mountain ranges, a haze, the scene's decorations, foreground foliage —
 * and every colour those layers use lives here, in one `HeroTheme` per scene,
 * so a scene is a palette rather than a picture. Winter is a seasonal theme,
 * not part of the daily cycle: it is only worn when asked for. Pure, so the
 * rule is tested without a clock.
 */

import type { HomeHero } from '@/lib/homeHeroPure';

export enum Scene {
  Morning = 'morning',
  Afternoon = 'afternoon',
  Sunset = 'sunset',
  Evening = 'evening',
  Night = 'night',
  Winter = 'winter',
}

/** What a scene adds on top of its landscape, beside the sun or moon. */
export enum SceneDecoration {
  /** Soft light raying down from the sun. */
  Sunbeams = 'sunbeams',
  /** A couple of birds and nothing else. */
  Birds = 'birds',
  /** Paper lanterns hanging from the foliage. */
  Lanterns = 'lanterns',
  /** Small warm lights strung along the foliage and dotted on the far shore. */
  FairyLights = 'fairyLights',
  /** Stars, and the moon's light caught on the leaves. */
  Stars = 'stars',
  /** Snow lying on the branches and bushes, and falling. */
  Snow = 'snow',
}

export type HeroTheme = {
  /** The sky, top to bottom. Its first stop is also the status bar's strip. */
  sky: readonly [string, string, string];
  /** The sun or moon, and the glow around it. */
  orb: { color: string; glow: string; moon: boolean };
  /** The far range, then the near one — paler with distance. */
  mountains: readonly [string, string];
  /** The atmosphere the ranges sit in, drawn over the far range's foot. */
  haze: string;
  /** The foreground leaves: their body and the edge the light catches. */
  foliage: { leaf: string; highlight: string; stem: string };
  /** The readability shade across the top, under the greeting: a light wash
   *  under dark ink, a dark one under white. */
  overlay: string;
  /** The scene's own accent — lanterns, lights, the sun's rays. */
  accent: string;
  decoration: SceneDecoration;
  /** The greeting's ink: dark on a pale sky, white on a deep one. The icons
   *  and the status bar follow it. */
  ink: 'dark' | 'light';
};

export const HERO_THEMES: Readonly<Record<Scene, HeroTheme>> = {
  [Scene.Morning]: {
    sky: ['#7DB4F0', '#BFD9F2', '#FCE8C8'],
    orb: { color: '#FFF4D6', glow: 'rgba(255, 236, 190, 0.55)', moon: false },
    mountains: ['#A9BEDC', '#7F9DC4'],
    haze: 'rgba(252, 240, 222, 0.55)',
    foliage: { leaf: '#4E9A5B', highlight: '#8FD08A', stem: '#3E6B3F' },
    overlay: 'rgba(255, 255, 255, 0.35)',
    accent: '#FFE3A3',
    decoration: SceneDecoration.Sunbeams,
    ink: 'dark',
  },
  [Scene.Afternoon]: {
    sky: ['#3C8BE6', '#7DB8F2', '#CDE6FA'],
    orb: { color: '#FFFBEA', glow: 'rgba(255, 250, 225, 0.5)', moon: false },
    mountains: ['#8DB2DE', '#5C8BC4'],
    haze: 'rgba(220, 238, 252, 0.5)',
    foliage: { leaf: '#3F9A4A', highlight: '#7ED36F', stem: '#2F6A35' },
    overlay: 'rgba(255, 255, 255, 0.35)',
    accent: '#FFFFFF',
    decoration: SceneDecoration.Birds,
    ink: 'dark',
  },
  [Scene.Sunset]: {
    sky: ['#D9624A', '#F29A5C', '#FBD08A'],
    orb: { color: '#FFE9A8', glow: 'rgba(255, 200, 120, 0.6)', moon: false },
    mountains: ['#C77C82', '#8E5776'],
    haze: 'rgba(250, 190, 140, 0.45)',
    foliage: { leaf: '#C8502E', highlight: '#F29245', stem: '#6B2E22' },
    overlay: 'rgba(60, 20, 40, 0.34)',
    accent: '#FFB347',
    decoration: SceneDecoration.Lanterns,
    ink: 'light',
  },
  [Scene.Evening]: {
    sky: ['#3E2F7A', '#7A4FB0', '#D98BA8'],
    orb: { color: '#FFD9C2', glow: 'rgba(255, 190, 170, 0.35)', moon: false },
    mountains: ['#6E5A9E', '#453A76'],
    haze: 'rgba(200, 150, 190, 0.35)',
    foliage: { leaf: '#2E3A4E', highlight: '#51607A', stem: '#1E2536' },
    overlay: 'rgba(20, 12, 50, 0.3)',
    accent: '#FFCB6B',
    decoration: SceneDecoration.FairyLights,
    ink: 'light',
  },
  [Scene.Night]: {
    sky: ['#0E1540', '#1F2A66', '#3B4A8C'],
    orb: { color: '#F2F4FF', glow: 'rgba(200, 210, 255, 0.3)', moon: true },
    mountains: ['#2E3A74', '#1B2352'],
    haze: 'rgba(90, 110, 180, 0.3)',
    foliage: { leaf: '#15204A', highlight: '#4C64A8', stem: '#0D1433' },
    overlay: 'rgba(5, 8, 30, 0.24)',
    accent: '#DDE4FF',
    decoration: SceneDecoration.Stars,
    ink: 'light',
  },
  [Scene.Winter]: {
    sky: ['#8E86C8', '#BDC3EA', '#EEF1FB'],
    orb: { color: '#FFF6EA', glow: 'rgba(255, 240, 225, 0.45)', moon: false },
    mountains: ['#C7CFEA', '#9DA8D2'],
    haze: 'rgba(240, 244, 252, 0.6)',
    foliage: { leaf: '#3C5A5E', highlight: '#FFFFFF', stem: '#2C3E42' },
    overlay: 'rgba(255, 255, 255, 0.35)',
    accent: '#FFFFFF',
    decoration: SceneDecoration.Snow,
    ink: 'dark',
  },
};

/**
 * Forces one scene whatever the clock says — for testing a scene on a device
 * without waiting for it. Set `EXPO_PUBLIC_HERO_SCENE` to a scene's name
 * (`sunset`, `winter`, …) at build time; anything else is ignored.
 */
/**
 * The painted scene the other screens (Me, Groups, New group, ...) wear for a
 * photograph picked on the Background screen. They have no photographs, so
 * each pick lands on the nearest palette: late morning and the seasons on the
 * bright afternoon sky, rain on the dusky evening one.
 */
export function sceneForHero(hero: HomeHero | null): Scene | null {
  switch (hero) {
    case null:
      return null;
    case 'morning':
      return Scene.Morning;
    case 'late-morning':
    case 'afternoon':
    case 'autumn':
    case 'spring':
      return Scene.Afternoon;
    case 'evening':
    case 'rainy':
      return Scene.Evening;
    case 'sunset':
      return Scene.Sunset;
    case 'night':
      return Scene.Night;
  }
}

export const SCENE_OVERRIDE: Scene | null = parseScene(process.env.EXPO_PUBLIC_HERO_SCENE);

export function parseScene(value: string | undefined): Scene | null {
  const scenes = Object.values(Scene) as string[];
  return value && scenes.includes(value) ? (value as Scene) : null;
}

/**
 * The scene for a moment, in the phone's own time:
 *
 *   05:00–08:00 morning · 08:00–16:00 afternoon · 16:00–18:30 sunset ·
 *   18:30–21:00 evening · 21:00–05:00 night
 *
 * `seasonal` puts winter in place of the daytime scenes (morning and afternoon)
 * — the optional seasonal theme; off, it never appears. `override` wins over
 * both.
 */
export function sceneFor(
  now: Date,
  options: { seasonal?: boolean; override?: Scene | null } = {},
): Scene {
  if (options.override) return options.override;
  const minutes = now.getHours() * 60 + now.getMinutes();
  let scene: Scene;
  if (minutes >= 5 * 60 && minutes < 8 * 60) scene = Scene.Morning;
  else if (minutes >= 8 * 60 && minutes < 16 * 60) scene = Scene.Afternoon;
  else if (minutes >= 16 * 60 && minutes < 18 * 60 + 30) scene = Scene.Sunset;
  else if (minutes >= 18 * 60 + 30 && minutes < 21 * 60) scene = Scene.Evening;
  else scene = Scene.Night;
  if (options.seasonal && (scene === Scene.Morning || scene === Scene.Afternoon)) {
    return Scene.Winter;
  }
  return scene;
}
