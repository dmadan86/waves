/**
 * Which landscape the dashboard's hero wears, from the clock: a bright lake in
 * the morning and afternoon, the sun going down at sunset, dusk in the evening,
 * the moon at night. Winter dawn is a seasonal theme, not part of the daily
 * cycle — it is only worn when asked for. Pure, so the rule is tested without a
 * clock.
 */

export enum Scene {
  Morning = 'morning',
  Afternoon = 'afternoon',
  Sunset = 'sunset',
  Evening = 'evening',
  Night = 'night',
  Winter = 'winter',
}

/**
 * The scene for a moment, in the phone's own time:
 *
 *   06:00–10:00 morning · 10:00–16:00 afternoon · 16:00–18:30 sunset ·
 *   18:30–20:00 evening · 20:00–06:00 night
 *
 * `seasonal` puts winter dawn in place of the daytime scenes (morning and
 * afternoon) — the optional seasonal theme; off, it never appears.
 */
export function sceneFor(now: Date, options: { seasonal?: boolean } = {}): Scene {
  const minutes = now.getHours() * 60 + now.getMinutes();
  let scene: Scene;
  if (minutes >= 6 * 60 && minutes < 10 * 60) scene = Scene.Morning;
  else if (minutes >= 10 * 60 && minutes < 16 * 60) scene = Scene.Afternoon;
  else if (minutes >= 16 * 60 && minutes < 18 * 60 + 30) scene = Scene.Sunset;
  else if (minutes >= 18 * 60 + 30 && minutes < 20 * 60) scene = Scene.Evening;
  else scene = Scene.Night;
  if (options.seasonal && (scene === Scene.Morning || scene === Scene.Afternoon)) {
    return Scene.Winter;
  }
  return scene;
}

/**
 * The colour of each scene's sky at its very top — what the status bar's strip
 * fades to once the scene has scrolled away under it, so the clock keeps a
 * ground that belongs to the picture.
 */
export const SCENE_SKY: Readonly<Record<Scene, string>> = {
  [Scene.Morning]: '#4D8FE0',
  [Scene.Afternoon]: '#3F8BE6',
  [Scene.Sunset]: '#E0703A',
  [Scene.Evening]: '#7A4FB0',
  [Scene.Night]: '#1F1F5C',
  [Scene.Winter]: '#8E86C8',
};

/**
 * The balance card's band under its landscape, left to right: the picture's own
 * light left edge running to its softer middle tone, so the card carries the
 * scene's colour on down under the figures and the actions without the dark
 * foreground trees it ends in on the right.
 */
export const SCENE_CARD_BAND: Readonly<Record<Scene, readonly [string, string]>> = {
  [Scene.Morning]: ['#F9F4EB', '#DCE8DF'],
  [Scene.Afternoon]: ['#E1F0FB', '#C4E4FA'],
  [Scene.Sunset]: ['#F7ECE4', '#E2C4D0'],
  [Scene.Evening]: ['#E0E2F5', '#C2C2EA'],
  [Scene.Night]: ['#D5E6FA', '#A9C0E0'],
  [Scene.Winter]: ['#EAF1FB', '#E0EBFB'],
};
