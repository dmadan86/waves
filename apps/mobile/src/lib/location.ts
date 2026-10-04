/**
 * Attaching where a spend happened (A43).
 *
 * Three decisions, each easy to get wrong in a way nobody notices:
 *
 * **Permission is never asked for on launch, and never in the background.** A
 * money app that opens with "Waves would like to use your location" gets denied,
 * and on iOS a denial is close to permanent. So the prompt happens only when the
 * person taps "Add location", having read what it is for — the deferred model
 * `push.ts` uses. When-in-use only; nothing here ever tracks.
 *
 * **The native module is loaded lazily.** `expo-location` is a native module and
 * is absent on web (the repo's visual-check surface) and in a build that did not
 * link it. A static import would take the whole app down at launch; a `require`
 * behind a try means a missing module is simply "location unavailable", and the
 * expense saves without one exactly as before this feature existed.
 *
 * **Nothing here throws.** Reading a fix is a hardware call that fails for
 * reasons that have nothing to do with the person — airplane mode, no GPS lock,
 * a simulator with no location set. Failures come back as a reason the caller
 * can show, not as an unhandled rejection.
 */

import { Platform } from 'react-native';

import type { ExpenseLocation } from '@waves/core';

/** Whether this platform can read a location at all (native only, not web). */
export const locationSupported = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * The `expo-location` surface this module uses, loaded lazily so a build without
 * the native module — or web — degrades to "unavailable" instead of crashing at
 * launch (the native-module rule). Typed narrowly to what is called here.
 */
interface ExpoLocation {
  getForegroundPermissionsAsync(): Promise<{ status: string; canAskAgain: boolean }>;
  requestForegroundPermissionsAsync(): Promise<{ status: string; canAskAgain: boolean }>;
  getCurrentPositionAsync(options?: {
    accuracy?: number;
  }): Promise<{ coords: { latitude: number; longitude: number }; timestamp?: number }>;
  getLastKnownPositionAsync(): Promise<{
    coords: { latitude: number; longitude: number };
    timestamp?: number;
  } | null>;
  reverseGeocodeAsync(location: {
    latitude: number;
    longitude: number;
  }): Promise<LocationGeocodedAddress[]>;
  Accuracy: { Balanced: number };
}

interface LocationGeocodedAddress {
  name?: string | null;
  street?: string | null;
  district?: string | null;
  subregion?: string | null;
  city?: string | null;
  region?: string | null;
}

/**
 * Whether the `ExpoLocation` native module is linked into this binary.
 *
 * Expo modules register on the JSI host object (`globalThis.expo.modules`) as
 * the app starts. Reading it is a plain property lookup that cannot throw —
 * unlike `require('expo-location')`, which evaluates ExpoLocation.js and calls
 * `requireNativeModule('ExpoLocation')`, throwing on a binary that never linked
 * it (a stale dev client, most often). In dev that throw is surfaced as a redbox
 * even when caught, so a try around the require is not enough on its own; this
 * check keeps us from ever requiring the wrapper when the module is not there.
 * Kept dependency-free (no `expo-modules-core` import) for the same reason the
 * scanner is: nothing loaded here may fail.
 */
function locationModuleLinked(): boolean {
  const host = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo;
  return host?.modules?.ExpoLocation != null;
}

/**
 * Whether a location can actually be read on this device right now: a native
 * platform *and* the `ExpoLocation` module linked into this binary. The UI gates
 * on this (not `locationSupported`) so a stale build shows no add-location
 * button rather than one that taps to nothing — `captureLocation` would return
 * `Unsupported`, which the field deliberately swallows.
 */
export function locationAvailable(): boolean {
  return locationSupported && locationModuleLinked();
}

function loadLocation(): ExpoLocation | null {
  if (!locationSupported || !locationModuleLinked()) return null;
  try {
    // Lazy so a build that did not link the module fails soft, not at launch.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-location') as ExpoLocation;
  } catch {
    return null;
  }
}

export enum LocationPermission {
  Granted = 'granted',
  Denied = 'denied',
  Undetermined = 'undetermined',
}

/** The current permission, without asking. `Denied` also covers "no module". */
export async function locationPermission(): Promise<LocationPermission> {
  const Location = loadLocation();
  if (!Location) return LocationPermission.Denied;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === 'granted'
      ? LocationPermission.Granted
      : status === 'undetermined'
        ? LocationPermission.Undetermined
        : LocationPermission.Denied;
  } catch {
    return LocationPermission.Denied;
  }
}

/** Why attaching a location did not happen. Only `denied` is the person's doing. */
export enum LocationFailure {
  /** Web, or a build with no location module — nothing to read. */
  Unsupported = 'unsupported',
  /** They said no, which is an answer. Route them to Settings if it stuck. */
  Denied = 'denied',
  /** Permission is there but no fix came back — no GPS lock, a bare simulator. */
  Unavailable = 'unavailable',
}

export type LocationResult =
  | { readonly ok: true; readonly location: ExpenseLocation }
  | { readonly ok: false; readonly why: LocationFailure };

/**
 * Build a short, human place name out of a reverse-geocode. A point-of-interest
 * name plus the city ("Third Wave Coffee, Indiranagar") reads better than a full
 * postal address, so this takes the most specific label and the locality and
 * drops the rest. Empty when the lookup gave nothing usable — the caller then
 * keeps the coordinates and shows them on a map.
 */
function placeName(address: LocationGeocodedAddress | undefined): string | null {
  if (!address) return null;
  const specific = address.name?.trim() || address.street?.trim() || '';
  const locality =
    address.district?.trim() ||
    address.city?.trim() ||
    address.subregion?.trim() ||
    address.region?.trim() ||
    '';
  // Dedupe when the specific label already is the locality (a plain area pin).
  const unique = [...new Set([specific, locality].filter(Boolean))];
  const name = unique.join(', ');
  return name.length > 0 ? name.slice(0, 120) : null;
}

/**
 * How old a cached fix can be and still count as "fresh enough to use
 * immediately" — skipping a new GPS read entirely. Two minutes covers the gap
 * between opening the app and speaking an expense; anything older is more
 * likely to be a stale cache from a previous session than where the person is
 * now.
 */
const FRESH_FIX_MS = 2 * 60 * 1000;

/**
 * How long a fresh GPS read gets before we give up on it. Short on purpose:
 * saving an expense must never wait on a slow or missing fix, only on this
 * brief attempt. Indoors or on a cold receiver `getCurrentPositionAsync` can
 * otherwise block for tens of seconds, or never resolve at all.
 */
const FAST_FIX_TIMEOUT_MS = 2000;

/**
 * Pure: whether a cached fix's `timestamp` is recent enough to skip a new GPS
 * read. Exported for unit testing the fast-fix decision without touching
 * `expo-location`. A missing or non-finite timestamp, or one in the future
 * (a clock oddity), is never "fresh".
 */
export function isFixFresh(timestamp: number | undefined, now: number): boolean {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age >= 0 && age <= FRESH_FIX_MS;
}

/**
 * A coordinate fix that is fast above all else — this is the only hardware
 * call {@link captureLocation} waits on, so saving an expense is never held up
 * by it for more than {@link FAST_FIX_TIMEOUT_MS}.
 *
 * The last known fix is used immediately when it is fresh (see
 * {@link isFixFresh}) — no GPS read at all. Otherwise a new read is raced
 * against the short timeout, low/balanced accuracy being plenty for naming a
 * place and dropping a pin; losing that race falls back to the last known fix
 * even if stale, since a slightly-off pin beats none. `null` only when neither
 * is available.
 */
async function readCoordsFast(
  Location: ExpoLocation,
): Promise<{ latitude: number; longitude: number } | null> {
  let last: { coords: { latitude: number; longitude: number }; timestamp?: number } | null = null;
  try {
    last = await Location.getLastKnownPositionAsync();
  } catch {
    last = null;
  }
  if (last?.coords && isFixFresh(last.timestamp, Date.now())) {
    return last.coords;
  }

  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FAST_FIX_TIMEOUT_MS)),
    ]);
    if (fresh?.coords) return fresh.coords;
  } catch {
    // A hardware failure on the fresh read is not the end — fall back below.
  }

  if (last?.coords) return last.coords;
  return null;
}

/**
 * Ask (once, just-in-time) and read a fast coordinate fix.
 *
 * A refusal comes back as `denied` — an answer, not an error. This never waits
 * on reverse-geocoding: the place name is not part of what this resolves, so a
 * caller that wants one must ask for it separately with {@link reverseGeocode},
 * on its own time. That is what keeps saving an expense from ever waiting on a
 * map to load — offline, reverse-geocoding can hang far longer than the
 * coordinate fix itself does, and a save needs only the coordinates.
 */
export async function captureLocation(): Promise<LocationResult> {
  const Location = loadLocation();
  if (!Location) return { ok: false, why: LocationFailure.Unsupported };

  try {
    const existing = await Location.getForegroundPermissionsAsync();
    const status =
      existing.status === 'granted'
        ? existing.status
        : (await Location.requestForegroundPermissionsAsync()).status;
    if (status !== 'granted') return { ok: false, why: LocationFailure.Denied };

    const coords = await readCoordsFast(Location);
    if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
      return { ok: false, why: LocationFailure.Unavailable };
    }

    return { ok: true, location: { lat: coords.latitude, lng: coords.longitude, name: null } };
  } catch {
    return { ok: false, why: LocationFailure.Unavailable };
  }
}

/**
 * Read a fix *only if permission was already granted* — never prompting.
 *
 * This is what lets add-expense stamp the current place automatically: opening
 * the form must never throw up a system location prompt (the anti-pattern this
 * module exists to avoid), so a fix is read only when the person has already
 * said yes on an earlier explicit "Add location". Undetermined, denied, no
 * module, or no GPS lock all come back as `null`, and the expense saves with no
 * place exactly as before. Like {@link captureLocation}, this never waits on
 * reverse-geocoding — the name comes back `null`; ask {@link reverseGeocode}
 * separately for one, on its own time.
 */
export async function captureLocationIfGranted(): Promise<ExpenseLocation | null> {
  const Location = loadLocation();
  if (!Location) return null;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null; // deliberately never requests here
    const coords = await readCoordsFast(Location);
    if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
      return null;
    }
    return { lat: coords.latitude, lng: coords.longitude, name: null };
  } catch {
    return null;
  }
}

/**
 * Name an arbitrary point picked on the map — best-effort, `null` when the
 * lookup fails, runs offline, or the module is absent (the caller keeps the
 * coordinates and shows the point). Unlike {@link captureLocation} this reads no
 * GPS and asks for no permission: reverse geocoding a chosen coordinate does not
 * reveal where the person is.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const Location = loadLocation();
  if (!Location) return null;
  try {
    const addresses = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    return placeName(addresses[0]);
  } catch {
    return null;
  }
}

/**
 * A deep link that opens the point in Google Maps — the Google Maps app when it
 * is installed (this universal `/maps/search/` URL hands off to it on both iOS
 * and Android), else Google Maps in the browser. One provider on every platform,
 * rather than Apple Maps on iOS, so "open the map" is always the same place.
 */
export function mapsUrl(location: ExpenseLocation): string {
  const query = `${location.lat},${location.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/** What to show for a location that has no name: a trimmed coordinate pair. */
export function coordLabel(location: ExpenseLocation): string {
  return `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
}
