/** A card over the photo: translucent white in light, the theme's surface in dark. */
export function sceneCardColor(scheme: string, surface: string): string {
  return scheme === 'dark' ? surface : 'rgba(255,255,255,0.92)';
}
