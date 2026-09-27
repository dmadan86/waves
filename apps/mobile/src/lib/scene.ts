/**
 * Which landscape the dashboard's hero wears, from the clock: a bright lake at
 * morning and afternoon, the sun going down at sunset, dusk in the evening, a
 * moon at night — and snow on the daytime scenes in the depth of winter. Pure,
 * so the rule is tested without a clock.
 */

export enum Scene {
  Morning = 'morning',
  Afternoon = 'afternoon',
  Sunset = 'sunset',
  Evening = 'evening',
  Night = 'night',
  Winter = 'winter',
}

/** The scene for a moment, in the phone's own time. */
export function sceneFor(now: Date): Scene {
  const minutes = now.getHours() * 60 + now.getMinutes();
  let scene: Scene;
  if (minutes >= 5 * 60 && minutes < 12 * 60) scene = Scene.Morning;
  else if (minutes >= 12 * 60 && minutes < 16 * 60) scene = Scene.Afternoon;
  else if (minutes >= 16 * 60 && minutes < 18 * 60 + 30) scene = Scene.Sunset;
  else if (minutes >= 18 * 60 + 30 && minutes < 20 * 60 + 30) scene = Scene.Evening;
  else scene = Scene.Night;
  // December to February, a daytime scene is the snowy one.
  const month = now.getMonth();
  const winter = month === 11 || month === 0 || month === 1;
  if (winter && (scene === Scene.Morning || scene === Scene.Afternoon)) return Scene.Winter;
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
