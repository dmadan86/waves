/**
 * The Apple App Site Association: the iOS twin of `assetlinks.json`.
 *
 * An invite is an ordinary https URL (`https://app.wavs.co.in/join#token`, or a
 * short `/g/<code>`). Scanning its QR code with the camera, or tapping it in a
 * chat, opened Safari even with Waves installed, because nothing told iOS the
 * app was entitled to this site's links: there was no document here, and the
 * app declared no associated domain. With this, and
 * `applinks:app.wavs.co.in` in the app's entitlements (`ios.associatedDomains`
 * in `apps/mobile/app.json`), iOS hands those paths straight to the app — and
 * to the web page only when the app is not installed.
 *
 * Only the invite paths are claimed. Everything else on this site is the web
 * app, and a link to it should keep opening in the browser.
 *
 * The rules Apple sets, and which fail silently when broken:
 *   - exactly `/.well-known/apple-app-site-association`, no extension;
 *   - served as JSON over https with **no redirect** — Apple's CDN follows none;
 *   - the app id is `<Team ID>.<bundle id>`.
 * iOS fetches this through Apple's CDN when the app is installed or updated,
 * not when a link is tapped, so a change here reaches a phone on its next
 * install or update of Waves.
 */

/** `<Apple Team ID>.<bundle id>` — `ios.appleTeamId` and `ios.bundleIdentifier`. */
export const APP_ID = 'JBAY4E524Q.app.wavs.mobile';

/** The invite paths, and only those: the same four the Android intent filter claims. */
export const INVITE_COMPONENTS = [
  { '/': '/join', comment: 'Invite, token in the fragment or the query' },
  { '/': '/join/*', comment: 'Invite, the older path form' },
  { '/': '/g', comment: 'Short group invite' },
  { '/': '/g/*', comment: 'Short group invite with its code' },
];

export const runtime = 'nodejs';

export function GET(): Response {
  return Response.json(
    {
      applinks: {
        details: [{ appIDs: [APP_ID], components: INVITE_COMPONENTS }],
      },
    },
    {
      headers: {
        // Apple's CDN re-fetches on its own schedule; a day matches
        // `assetlinks.json` and keeps a fix from waiting on anything else.
        'Cache-Control': 'public, max-age=86400',
      },
    },
  );
}
