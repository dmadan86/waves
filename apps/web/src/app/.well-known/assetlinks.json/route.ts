/**
 * Digital Asset Links: the statement that lets the Android app claim this site's
 * links.
 *
 * A join link is an ordinary https URL (`https://app.wavs.co.in/join#token`), and
 * without this document Android has no way to know the app is entitled to it —
 * so tapping an invite in WhatsApp opened the web page and left the person to
 * find the app themselves. With it, and `autoVerify` on the app's intent filter,
 * Android fetches this at install time, checks the signing certificate of the
 * installed package against the list below, and from then on sends the link
 * straight to the app. Nothing is asked of the person and there is no chooser.
 *
 * WHY THREE FINGERPRINTS, NOT ONE. Play App Signing re-signs every upload with a
 * key Google holds, so the certificate a phone sees is *not* the one the APK was
 * built with. All of the certificates an installed copy might legitimately carry
 * have to be listed or verification fails for the builds signed by the ones that
 * are missing — silently, presenting as "the link works on my phone but not
 * hers". These are Play's app signing certificate and the upload certificates,
 * read off the Play Console.
 *
 * They are not secrets. A certificate fingerprint is a public identifier — this
 * whole document is meant to be fetched by anyone, and Google's own crawler is
 * one of the readers.
 *
 * The path is fixed by the spec and is not negotiable: exactly
 * `/.well-known/assetlinks.json`, served as JSON over https with no redirect.
 * Android follows no redirects here, so a host that bounces this to a CDN or to
 * a trailing slash fails verification with no error anywhere a person can see.
 */

/** The Android package the statement is about — `expo.android.package`. */
const PACKAGE = 'app.waves.mobile';

/**
 * SHA-256 of every certificate a legitimate install can be signed with.
 *
 * Add to this list, never replace it: an older release stays installed on
 * phones long after the key that signed it stopped being used, and dropping its
 * fingerprint breaks link handling on exactly those devices.
 */
const CERT_FINGERPRINTS = [
  'C6:49:25:7D:02:E3:A9:3D:57:69:89:38:5A:8E:1A:4E:BB:3D:3E:C9:AB:83:5B:8D:30:B1:0A:2A:B3:1E:81:AE',
  '5C:A5:76:10:F5:6A:B0:A3:81:70:05:89:54:BD:7E:84:62:77:F7:AB:02:0D:F3:3A:5F:B7:96:8B:3D:B6:CB:73',
  'EB:90:C2:92:01:08:8A:7D:A6:B7:62:E0:D3:B9:A6:64:DF:C4:42:3D:9C:2C:EE:85:C2:37:6E:65:CA:CF:50:27',
  // The upload key (`~/keys/waves-upload.jks`). A phone that installed from Play
  // never sees this certificate — Play re-signs with one of the three above — so
  // this line is for the builds that skip Play: the release APKs handed round
  // for testing, which are signed with the upload key itself. Without it those
  // builds are the one place an invite link still opens the browser, which is
  // exactly where a link is most likely to be tested.
  'CD:72:24:BE:46:44:D1:0F:BC:11:31:04:B8:CD:96:2F:60:12:02:52:1D:03:07:B1:E2:31:43:6D:02:4D:EA:3E',
  // The EAS-managed upload key, generated when the first cloud production build
  // ran and now the key that signs what goes to Play. It is listed alongside the
  // one above rather than instead of it: release APKs built locally are still
  // signed with `~/keys/waves-upload.jks`, and those installs stay on phones.
  // Both are upload certificates, so neither is what a Play install presents —
  // but both are what a sideloaded build presents, and a link has to open in
  // either.
  'AE:F2:B8:46:40:A1:61:AA:3B:42:F0:FF:B1:7B:A3:20:34:38:9F:5A:06:8B:D3:F5:93:0F:BA:20:A3:B5:DE:F1',
];

export const runtime = 'nodejs';

export function GET(): Response {
  return Response.json(
    [
      {
        // `handle_all_urls` is what makes this an App Links statement rather
        // than only a login-credential one; `get_login_creds` lets the phone's
        // password manager offer this site's saved credentials in the app.
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: PACKAGE,
          sha256_cert_fingerprints: CERT_FINGERPRINTS,
        },
      },
    ],
    {
      headers: {
        // Android re-checks periodically rather than once, and Google's
        // verification service caches on its own. A day is long enough to save
        // the traffic and short enough that adding a fingerprint takes effect
        // without waiting on a redeploy of anything else.
        'Cache-Control': 'public, max-age=86400',
      },
    },
  );
}
