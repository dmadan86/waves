// Pure helpers for a share that arrives from another app (the system share
// sheet -> Waves). No native imports so vitest can load it directly.

/** A shared image, already copied into the app's own cache by the native side. */
export interface IncomingShare {
  /** Unique per delivery; the dedupe key. */
  readonly id: string;
  /** `file://` URI inside the app cache, readable without any permission grant. */
  readonly uri: string;
  readonly mimeType: string;
}

/**
 * The native payload as an `IncomingShare`, or null when it is not a usable
 * image. Native hands over a plain object; anything else (a text share, a
 * malformed event, a file that failed to copy) is dropped here rather than
 * reaching the router.
 */
export function parseIncomingShare(raw: unknown): IncomingShare | null {
  if (raw === null || typeof raw !== 'object') return null;
  const { id, uri, mimeType } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof uri !== 'string' || !/^file:\/\//i.test(uri)) return null;
  if (typeof mimeType !== 'string' || !/^image\//i.test(mimeType)) return null;
  return { id, uri, mimeType: mimeType.toLowerCase() };
}

/**
 * Remembers which deliveries were already handled. The native side can offer
 * the same share more than once (the initial read plus the live event, an
 * activity recreate, the app returning to the foreground), and a share must
 * only ever be turned into one expense.
 */
export function createShareDedupe(cap = 32): { accept: (id: string) => boolean } {
  const seen: string[] = [];
  return {
    accept(id: string): boolean {
      if (seen.includes(id)) return false;
      seen.push(id);
      if (seen.length > cap) seen.shift();
      return true;
    },
  };
}

/**
 * Whether a shared URI may be copied. Only another app's `content://` provider
 * is trusted: `file://` and every other scheme could point at Waves' private
 * files, and a provider of our own package would serve them. `resolvedPackage`
 * is the package that really serves the authority (PackageManager's
 * resolveContentProvider), null when Android 11+ package visibility hides it —
 * an app always sees its own providers, so an unresolved one is someone else's
 * (the gallery, Photos, WhatsApp) and is allowed. The native side
 * (WavesShareModule.kt) applies the same rules.
 */
export function isAcceptableShareUri(
  scheme: string | null | undefined,
  authority: string | null | undefined,
  packageName: string,
  resolvedPackage: string | null | undefined,
): boolean {
  if (scheme !== 'content') return false;
  if (!authority || authority.includes('@')) return false;
  if (authority.startsWith(packageName)) return false;
  if (resolvedPackage === packageName) return false;
  return true;
}
