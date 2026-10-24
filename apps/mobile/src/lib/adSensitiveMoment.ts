// Purchase intent and errors buy a quiet window, even across screen changes.
let quietUntil = 0;
export function quietAdsFor(ms = 300000) {
  quietUntil = Math.max(quietUntil, Date.now() + ms);
}
export function adsAreQuiet(now: number) {
  return now < quietUntil;
}
