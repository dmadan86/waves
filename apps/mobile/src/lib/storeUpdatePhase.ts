/**
 * Where an in-app update stands, decided without a phone.
 *
 * The update bar has four faces, the same four the bar in Play's own apps has:
 *
 *   - **available** — "Update Waves" with an Update button (and a way to put it
 *     off, per version);
 *   - **downloading** — the button becomes a progress fill while Play downloads
 *     in the background and the app stays usable;
 *   - **ready** — downloaded, waiting for the person to choose the moment:
 *     "Restart";
 *   - **none** — nothing to say.
 *
 * Play reports its install states as names (`lib/storeUpdate.tsx` passes them
 * through from the native module), and this file is the whole of how those
 * names move the bar. Kept pure so the transitions — including the unhappy
 * ones, a declined sheet or a failed download — are tested without Play.
 */

import { compareVersions } from '@waves/core';

export type UpdatePhase =
  | { readonly kind: 'none' }
  | { readonly kind: 'available'; readonly version: string }
  | { readonly kind: 'downloading'; readonly version: string; readonly progress: number | null }
  | { readonly kind: 'ready'; readonly version: string };

export const NO_UPDATE: UpdatePhase = { kind: 'none' };

/** What the native module's `check` answers (Android). */
export interface PlayUpdateInfo {
  readonly available: boolean;
  readonly inProgress: boolean;
  readonly versionCode: number;
  readonly flexible: boolean;
  readonly immediate: boolean;
  readonly status: string;
  readonly downloaded: number;
  readonly total: number;
}

/** One `onStatus` event from the native module. */
export interface PlayStatusEvent {
  readonly status: string;
  readonly downloaded?: number;
  readonly total?: number;
}

/** Bytes so far as a share, or null while Play has not said how big it is. */
export function progressOf(downloaded?: number, total?: number): number | null {
  if (!total || total <= 0 || downloaded === undefined) return null;
  return Math.max(0, Math.min(1, downloaded / total));
}

/**
 * The bar's face from a fresh check — on launch, and every time the app comes
 * back to the foreground. A download already running, or one finished while
 * the app was away, is picked up where it is rather than offered again.
 */
export function phaseFromCheck(info: PlayUpdateInfo | null): UpdatePhase {
  if (!info) return NO_UPDATE;
  const version = String(info.versionCode);
  if (info.status === 'DOWNLOADED') return { kind: 'ready', version };
  if (info.status === 'DOWNLOADING' || info.status === 'PENDING') {
    return { kind: 'downloading', version, progress: progressOf(info.downloaded, info.total) };
  }
  // Only a flexible update is offered from the bar: it is the one that lets
  // somebody keep using the app while it downloads.
  if (info.available && info.flexible) return { kind: 'available', version };
  return NO_UPDATE;
}

/** How a status event from Play moves the bar on. */
export function phaseAfter(phase: UpdatePhase, event: PlayStatusEvent): UpdatePhase {
  if (phase.kind === 'none') return phase;
  const { version } = phase;
  switch (event.status) {
    // Said yes on Play's sheet: the download is about to start.
    case 'ACCEPTED':
    case 'PENDING':
      return { kind: 'downloading', version, progress: null };
    case 'DOWNLOADING':
      return { kind: 'downloading', version, progress: progressOf(event.downloaded, event.total) };
    case 'DOWNLOADED':
      return { kind: 'ready', version };
    // Said no, or the download did not finish: back to the offer, so the
    // person can try again whenever they like.
    case 'DECLINED':
    case 'CANCELED':
    case 'FAILED':
      return { kind: 'available', version };
    // Play is installing, and the app is about to restart into the new
    // version. Nothing left to show.
    case 'INSTALLING':
    case 'INSTALLED':
      return NO_UPDATE;
    default:
      return phase;
  }
}

/**
 * iOS has no in-app updates, so it asks the App Store what its newest version
 * is and offers the store page when that is newer than this build.
 *
 * Returns the store's version when it is newer, otherwise null — including for
 * any answer that cannot be read, because "maybe there is an update" is not a
 * reason to show a bar.
 */
export function newerStoreVersion(installed: string | null, lookup: unknown): string | null {
  if (!installed) return null;
  const results = (lookup as { results?: { version?: unknown }[] } | null)?.results;
  const version = results?.[0]?.version;
  if (typeof version !== 'string') return null;
  return compareVersions(version, installed) === 1 ? version : null;
}

/** Whether "Not now" for this version still holds. Only an offer can be put off. */
export function isPutOff(phase: UpdatePhase, dismissedVersion: string | null): boolean {
  return phase.kind === 'available' && dismissedVersion === phase.version;
}
