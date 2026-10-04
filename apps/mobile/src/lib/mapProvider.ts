/**
 * Which map engine a platform uses. Pure, so the choice is testable without
 * react-native-maps.
 *
 * iOS uses Apple Maps (MapKit): free, no key, no billing. Android keeps Google
 * Maps. Custom Google JSON styles must only ever be applied where this says
 * `'google'`; Apple ignores them.
 */

export type MapProvider = 'apple' | 'google';

export function mapProviderFor(platform: string): MapProvider {
  return platform === 'ios' ? 'apple' : 'google';
}

/**
 * The `provider` prop for a react-native-maps `MapView`: `undefined` selects
 * Apple Maps on iOS, `'google'` is PROVIDER_GOOGLE's value.
 */
export function mapViewProviderProp(platform: string): 'google' | undefined {
  return mapProviderFor(platform) === 'google' ? 'google' : undefined;
}

/**
 * Whether the inline preview may call the Google Static Maps API. Never on iOS,
 * which draws a native Apple map instead.
 */
export function staticGoogleAllowed(platform: string): boolean {
  return mapProviderFor(platform) === 'google';
}

/**
 * The region a Web-Mercator tile `zoom` shows in a `width` x `height` frame, so a
 * native preview frames the point like the tile grid does. Longitude spans
 * 360/2^zoom per 256px; latitude is scaled by the frame's aspect and cos(lat).
 */
export function regionForZoom(
  center: { lat: number; lng: number },
  zoom: number,
  width: number,
  height: number,
): { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } {
  const longitudeDelta = (360 / 2 ** zoom) * (width / 256);
  const latitudeDelta = (360 / 2 ** zoom) * (height / 256) * Math.cos((center.lat * Math.PI) / 180);
  return { latitude: center.lat, longitude: center.lng, latitudeDelta, longitudeDelta };
}
