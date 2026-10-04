import { describe, expect, it } from 'vitest';

import {
  mapProviderFor,
  mapViewProviderProp,
  regionForZoom,
  staticGoogleAllowed,
} from '../src/lib/mapProvider';

describe('regionForZoom', () => {
  it('halves the span per zoom level and keeps the centre', () => {
    const a = regionForZoom({ lat: 0, lng: 10 }, 15, 256, 256);
    const b = regionForZoom({ lat: 0, lng: 10 }, 16, 256, 256);
    expect(a.longitude).toBe(10);
    expect(a.longitudeDelta / b.longitudeDelta).toBeCloseTo(2);
    expect(a.latitudeDelta).toBeCloseTo(a.longitudeDelta);
  });
});

describe('map provider selection', () => {
  it('uses Apple Maps on iOS and Google elsewhere', () => {
    expect(mapProviderFor('ios')).toBe('apple');
    expect(mapProviderFor('android')).toBe('google');
    expect(mapProviderFor('web')).toBe('google');
  });

  it('omits the MapView provider prop on iOS only', () => {
    expect(mapViewProviderProp('ios')).toBeUndefined();
    expect(mapViewProviderProp('android')).toBe('google');
  });

  it('allows Google Static Maps everywhere except iOS', () => {
    expect(staticGoogleAllowed('ios')).toBe(false);
    expect(staticGoogleAllowed('android')).toBe(true);
  });
});
