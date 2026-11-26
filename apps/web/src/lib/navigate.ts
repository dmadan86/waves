/**
 * Leave a form once its write has succeeded.
 *
 * A soft navigation can hang on a slow route fetch even though the data is
 * saved, leaving "Saving…" on screen. If we are still on the old page shortly
 * after, load the destination the hard way.
 */
export function goAfterSave(
  router: { replace: (href: string) => void },
  href: string,
  waitMs = 2500,
): void {
  router.replace(href);
  setTimeout(() => {
    if (window.location.pathname !== href) window.location.assign(href);
  }, waitMs);
}
