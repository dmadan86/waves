/**
 * Which Google Cloud project this build's Drive backup belongs to.
 *
 * Drive needs its own client ids — the app's *login* goes through Supabase's
 * hosted Google flow and never holds a Google client id of its own, so nothing
 * here is shared with sign-in.
 *
 * There are two ids, and neither of them is an Android one. That is not an
 * omission: Google identifies an Android app by its package name and signing
 * certificate, checked by Play services against a client registered for that
 * pair, so there is nothing for the bundle to carry. What the SDK does need is
 *
 *   * a **web** client id, which names the Cloud project the consent belongs to
 *     — no browser is involved and no server is called, it is an identifier;
 *   * an **iOS** client id, because Apple builds are matched by bundle id.
 *
 * Neither is secret — these flows have no client secret, which is the whole
 * point of them on a phone — but they name a project belonging to whoever is
 * building, so they are read from the environment rather than committed.
 * `EXPO_PUBLIC_*` is inlined by Metro at build time, which is why each one is
 * spelled out statically below: a computed `process.env[key]` is not
 * substituted and would read as undefined in a release bundle.
 *
 * With none set the app builds and runs; the backup screen says the destination
 * is unavailable in this build instead of opening a consent page that would be
 * rejected. See README, "Backing the personal ledger up to Drive".
 */

import { Platform } from 'react-native';

import type { CloudProviderId } from './types';

/** The Cloud project's web client id. Required on every platform. */
export function webClientId(): string {
  const id = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID_WEB;
  if (!id) throw new Error('no Google web client id configured for Drive');
  return id;
}

/** The iOS client id, for the one platform that is matched by bundle id. */
function iosClientId(): string | undefined {
  const id = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID_IOS;
  return id && id.length > 0 ? id : undefined;
}

export function clientId(provider: CloudProviderId): string {
  const id = provider === 'gdrive' ? iosClientId() : undefined;
  // Callers gate on `isConfigured` first; reaching here without an id is a
  // programming error, not a user-facing state, so it throws rather than
  // handing the SDK an empty string.
  if (!id) throw new Error(`no iOS OAuth client id configured for ${provider}`);
  return id;
}

/**
 * True when this build names a project Drive consent can be asked for.
 *
 * Android needs only the web client id, because the app itself is identified by
 * its signature. iOS needs both. The web platform has neither flow — Google's
 * browser clients require a secret, and a secret in a page is not a secret —
 * so Drive backup is simply not offered there.
 */
export function isConfigured(provider: CloudProviderId): boolean {
  if (provider !== 'gdrive') return false;
  const web = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID_WEB;
  if (!web || web.length === 0) return false;
  if (Platform.OS === 'web') return false;
  return Platform.OS === 'ios' ? iosClientId() !== undefined : true;
}
