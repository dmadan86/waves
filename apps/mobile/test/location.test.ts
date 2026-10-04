/**
 * Attaching where a spend happened (A43): permission only on an explicit tap,
 * a fix that neither hangs nor gives up too early, a short human place name,
 * and nothing that throws.
 *
 * `expo-location` is reached through `require`, which `vi.mock` does not
 * intercept, so the module is stubbed in Node's require cache.
 */

import { createRequire } from 'node:module';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ platform: { OS: 'android' as string } }));
vi.mock('react-native', () => ({ Platform: native.platform }));

const nodeRequire = createRequire(import.meta.url);
const locationPath = nodeRequire.resolve('expo-location');
const original = nodeRequire.cache[locationPath];

type Coords = {
  coords: { latitude: number; longitude: number };
  timestamp?: number;
};
const Location = {
  getForegroundPermissionsAsync: vi.fn<() => Promise<{ status: string; canAskAgain: boolean }>>(),
  requestForegroundPermissionsAsync:
    vi.fn<() => Promise<{ status: string; canAskAgain: boolean }>>(),
  getCurrentPositionAsync: vi.fn<(o?: unknown) => Promise<Coords>>(),
  getLastKnownPositionAsync: vi.fn<() => Promise<Coords | null>>(),
  reverseGeocodeAsync: vi.fn<(p: unknown) => Promise<Record<string, string | null>[]>>(),
  Accuracy: { Balanced: 3 },
};

type Host = { expo?: { modules?: Record<string, unknown> } };
const host = globalThis as Host;
const savedExpo = host.expo;

afterAll(() => {
  if (original) nodeRequire.cache[locationPath] = original;
  else delete nodeRequire.cache[locationPath];
  host.expo = savedExpo;
});

const HERE = { coords: { latitude: 12.97159, longitude: 77.64115 } };

beforeEach(() => {
  vi.resetModules();
  native.platform.OS = 'android';
  host.expo = { modules: { ExpoLocation: {} } };
  nodeRequire.cache[locationPath] = {
    id: locationPath,
    filename: locationPath,
    loaded: true,
    exports: Location,
  } as never;
  Location.getForegroundPermissionsAsync
    .mockReset()
    .mockResolvedValue({ status: 'granted', canAskAgain: true });
  Location.requestForegroundPermissionsAsync
    .mockReset()
    .mockResolvedValue({ status: 'granted', canAskAgain: true });
  Location.getCurrentPositionAsync.mockReset().mockResolvedValue(HERE);
  Location.getLastKnownPositionAsync.mockReset().mockResolvedValue(null);
  Location.reverseGeocodeAsync
    .mockReset()
    .mockResolvedValue([{ name: 'Third Wave Coffee', district: 'Indiranagar', city: 'Bengaluru' }]);
});

afterEach(() => {
  vi.useRealTimers();
});

const load = () => import('../src/lib/location');

describe('whether a location can be read at all', () => {
  it('needs a native platform and the linked module', async () => {
    expect((await load()).locationAvailable()).toBe(true);

    host.expo = { modules: {} };
    expect((await load()).locationAvailable()).toBe(false);
  });

  it('is off on web, whatever is registered', async () => {
    native.platform.OS = 'web';
    const lib = await load();
    expect(lib.locationSupported).toBe(false);
    expect(lib.locationAvailable()).toBe(false);
    await expect(lib.captureLocation()).resolves.toEqual({ ok: false, why: 'unsupported' });
    await expect(lib.captureLocationIfGranted()).resolves.toBeNull();
    await expect(lib.reverseGeocode(1, 2)).resolves.toBeNull();
  });

  it('treats a module that throws on require as unsupported', async () => {
    Object.defineProperty(nodeRequire.cache[locationPath]!, 'exports', {
      get() {
        throw new Error("Cannot find native module 'ExpoLocation'");
      },
    });
    const lib = await load();
    await expect(lib.captureLocation()).resolves.toEqual({ ok: false, why: 'unsupported' });
    await expect(lib.locationPermission()).resolves.toBe('denied');
  });
});

describe('reading the current permission without asking', () => {
  it.each([
    ['granted', 'granted'],
    ['undetermined', 'undetermined'],
    ['denied', 'denied'],
  ])('maps %s to %s', async (status, expected) => {
    Location.getForegroundPermissionsAsync.mockResolvedValue({ status, canAskAgain: true });
    await expect((await load()).locationPermission()).resolves.toBe(expected);
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('calls a failing query denied, and a missing module too', async () => {
    Location.getForegroundPermissionsAsync.mockRejectedValue(new Error('boom'));
    await expect((await load()).locationPermission()).resolves.toBe('denied');

    host.expo = {};
    await expect((await load()).locationPermission()).resolves.toBe('denied');
  });
});

describe('capturing a location on an explicit tap', () => {
  it('returns the coordinates immediately, never waiting on reverse-geocoding', async () => {
    const result = await (await load()).captureLocation();

    // A missing name still yields a saveable (coordinates-only) location: the
    // place name is never part of what `captureLocation` resolves, even though
    // the mocked `reverseGeocodeAsync` above would gladly return one.
    expect(result).toEqual({
      ok: true,
      location: { lat: 12.97159, lng: 77.64115, name: null },
    });
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 3 });
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.reverseGeocodeAsync).not.toHaveBeenCalled();
  });

  it('uses a fresh cached fix immediately, skipping a new GPS read', async () => {
    Location.getLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 9, longitude: 10 },
      timestamp: Date.now() - 1000,
    });

    const result = await (await load()).captureLocation();

    expect(result).toEqual({ ok: true, location: { lat: 9, lng: 10, name: null } });
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('reads a new fix when the cached one is too old to trust', async () => {
    Location.getLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 9, longitude: 10 },
      timestamp: Date.now() - 10 * 60 * 1000,
    });

    const result = await (await load()).captureLocation();

    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 3 });
    expect(result).toMatchObject({ ok: true, location: { lat: 12.97159, lng: 77.64115 } });
  });

  it('asks just in time when nobody has answered yet, and respects a no', async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValue({
      status: 'undetermined',
      canAskAgain: true,
    });
    Location.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    });

    await expect((await load()).captureLocation()).resolves.toEqual({
      ok: false,
      why: 'denied',
    });
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('carries on once the prompt is accepted', async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValue({
      status: 'undetermined',
      canAskAgain: true,
    });

    const result = await (await load()).captureLocation();
    expect(result.ok).toBe(true);
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('falls back to the last known fix when the fresh read fails', async () => {
    Location.getCurrentPositionAsync.mockRejectedValue(new Error('no GPS'));
    Location.getLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 1, longitude: 2 },
    });

    const result = await (await load()).captureLocation();
    expect(result).toMatchObject({ ok: true, location: { lat: 1, lng: 2 } });
  });

  it('gives up on a hanging fresh read after the fast-fix timeout and uses the cached fix', async () => {
    vi.useFakeTimers();
    Location.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}));
    // No timestamp, so this cached fix is never "fresh" — it is used only as
    // the fallback once the fresh read times out, not read up front.
    Location.getLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 5, longitude: 6 },
    });

    const pending = (await load()).captureLocation();
    // The fast-fix timeout is short (~2s) precisely so Save never waits long.
    await vi.advanceTimersByTimeAsync(2000);

    await expect(pending).resolves.toMatchObject({ ok: true, location: { lat: 5, lng: 6 } });
  });

  it('reports unavailable when there is no fix of any kind', async () => {
    Location.getCurrentPositionAsync.mockRejectedValue(new Error('no GPS'));
    Location.getLastKnownPositionAsync.mockRejectedValue(new Error('no cache'));

    await expect((await load()).captureLocation()).resolves.toEqual({
      ok: false,
      why: 'unavailable',
    });
  });

  it('refuses a fix with non-finite coordinates', async () => {
    Location.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: Number.NaN, longitude: 3 },
    });

    await expect((await load()).captureLocation()).resolves.toEqual({
      ok: false,
      why: 'unavailable',
    });
  });

  it('reports unavailable if the permission check itself throws', async () => {
    Location.getForegroundPermissionsAsync.mockRejectedValue(new Error('binder died'));
    await expect((await load()).captureLocation()).resolves.toEqual({
      ok: false,
      why: 'unavailable',
    });
  });
});

describe('stamping a location automatically', () => {
  it('reads a fix only when permission was already granted, never prompting', async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValue({
      status: 'undetermined',
      canAskAgain: true,
    });
    await expect((await load()).captureLocationIfGranted()).resolves.toBeNull();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('returns the coordinates once granted, with no name and no geocode call', async () => {
    await expect((await load()).captureLocationIfGranted()).resolves.toEqual({
      lat: 12.97159,
      lng: 77.64115,
      name: null,
    });
    expect(Location.reverseGeocodeAsync).not.toHaveBeenCalled();
  });

  it('comes back empty without a fix', async () => {
    Location.getCurrentPositionAsync.mockRejectedValue(new Error('no GPS'));
    await expect((await load()).captureLocationIfGranted()).resolves.toBeNull();
  });

  it('swallows a failing permission check', async () => {
    Location.getForegroundPermissionsAsync.mockRejectedValue(new Error('boom'));
    await expect((await load()).captureLocationIfGranted()).resolves.toBeNull();
  });
});

describe('deciding whether a cached fix is fresh enough to skip a new GPS read', () => {
  it.each([
    [0, true],
    [60_000, true],
    [120_000, true], // exactly the two-minute boundary
  ])('is fresh at %d ms old', async (age, expected) => {
    const { isFixFresh } = await load();
    const now = 1_700_000_000_000;
    expect(isFixFresh(now - age, now)).toBe(expected);
  });

  it('is stale just past the two-minute boundary', async () => {
    const { isFixFresh } = await load();
    const now = 1_700_000_000_000;
    expect(isFixFresh(now - 120_001, now)).toBe(false);
  });

  it('is never fresh with no timestamp, or a nonsensical one', async () => {
    const { isFixFresh } = await load();
    const now = 1_700_000_000_000;
    expect(isFixFresh(undefined, now)).toBe(false);
    expect(isFixFresh(Number.NaN, now)).toBe(false);
    // A timestamp in the future (a clock oddity) is not "fresh" either.
    expect(isFixFresh(now + 1000, now)).toBe(false);
  });
});

describe('naming a point picked on the map', () => {
  it.each([
    [{ street: '100 Feet Rd', city: 'Bengaluru' }, '100 Feet Rd, Bengaluru'],
    [{ name: 'Indiranagar', district: 'Indiranagar' }, 'Indiranagar'],
    [{ name: '  ', subregion: 'Bangalore Urban' }, 'Bangalore Urban'],
    [{ region: 'Karnataka' }, 'Karnataka'],
    [{ name: null, street: null }, null],
  ])('turns %j into %j', async (address, expected) => {
    Location.reverseGeocodeAsync.mockResolvedValue([address]);
    await expect((await load()).reverseGeocode(1, 2)).resolves.toBe(expected);
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('caps a very long name at 120 characters', async () => {
    Location.reverseGeocodeAsync.mockResolvedValue([{ name: 'x'.repeat(300) }]);
    const name = await (await load()).reverseGeocode(1, 2);
    expect(name).toHaveLength(120);
  });

  it('answers null when the lookup fails', async () => {
    Location.reverseGeocodeAsync.mockRejectedValue(new Error('offline'));
    await expect((await load()).reverseGeocode(1, 2)).resolves.toBeNull();
  });
});

describe('showing a location', () => {
  it('links to the point in Google Maps and labels it by coordinates', async () => {
    const { coordLabel, mapsUrl } = await load();
    const spot = { lat: 12.971599, lng: 77.641151, name: null };

    expect(mapsUrl(spot)).toBe(
      'https://www.google.com/maps/search/?api=1&query=12.971599,77.641151',
    );
    expect(coordLabel(spot)).toBe('12.9716, 77.6412');
  });
});
