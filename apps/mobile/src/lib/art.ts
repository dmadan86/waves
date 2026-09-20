/**
 * Artwork that is fetched, not shipped.
 *
 * Illustrations are the heaviest thing a screen can ask for and the least
 * likely to change with the code around them: bundling eight of them adds
 * megabytes to every install, for pictures that only one screen in Settings
 * ever draws. So they live in a public Cloudflare R2 bucket and arrive on
 * demand, cached on disk by `expo-image` after the first look.
 *
 * Two rules follow from that, and both are the caller's job:
 *
 *  - **Nothing may depend on the picture arriving.** Every surface that draws
 *    one also draws something without it — a glyph, a colour, a label. A phone
 *    on a train still gets a working screen, just a plainer one.
 *  - **No credential, ever.** The bucket is public and read-only. The private
 *    image bucket (receipts, avatars, group photos) is reached through the
 *    `r2-sign` edge function and has nothing to do with this.
 *
 * The base is overridable so a fork, a staging bucket or a local server can
 * take over without touching a call site.
 */

/**
 * The `waves-art` bucket's public dev URL. It is a constant rather than a
 * required environment variable on purpose: a build that forgets to set one
 * should still draw the pictures, and the bucket is public and read-only, so
 * there is nothing here to keep out of a bundle.
 */
const DEFAULT_BASE = 'https://pub-311decd36a1e4e27a4f0dd9d6d71637f.r2.dev';

const BASE = (process.env.EXPO_PUBLIC_ART_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, '');

/** A URL for one piece of remote artwork, e.g. `artUrl('feedback/voice.png')`. */
export function artUrl(path: string): string {
  return `${BASE}/${path.replace(/^\/+/, '')}`;
}
