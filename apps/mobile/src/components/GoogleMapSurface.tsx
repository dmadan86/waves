/**
 * The native Google Maps surface for the location picker.
 *
 * Isolated in its own file for the same reason `VoiceCapture` is: it imports a
 * native module (`react-native-maps`) whose JS throws on any binary built before
 * that module existed. `LocationPickerSheet` reaches it through a guarded
 * `require` (see `nativeMaps`) and falls back to the raster-tile map when it is
 * not there — so an OTA update that carries this file to an older build degrades
 * to tiles instead of crashing at launch.
 *
 * It draws only the map itself: a full-bleed Google `MapView` with a fixed
 * centre pin, the point that gets saved. The map pans and pinch-zooms natively;
 * the parent reads the resting centre from `onCenterChange` and drives
 * programmatic moves (reseed, "use my location") through the `mapRef`.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';

import { iconSize, useTheme } from '@waves/ui';

import { mapViewProviderProp, regionForZoom } from '@/lib/mapProvider';
import type { LatLng } from '@/lib/mapTiles';

/**
 * A region for a centre point. The deltas set the zoom: a tight span for a known
 * point, a wide one for the "no starting point" world view. Longitude delta is
 * derived from latitude by the frame's aspect so the map is not stretched.
 */
export function regionForCenter(center: LatLng, span: 'point' | 'world', aspect: number): Region {
  const latitudeDelta = span === 'point' ? 0.01 : 90;
  return {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta,
    longitudeDelta: latitudeDelta * (aspect > 0 ? aspect : 1),
  };
}

/**
 * A small, non-interactive map for `MapPreview` — iOS only (Apple Maps). All
 * gestures are off and touches pass through to the wrapping `Pressable`.
 */
export function StaticMapSurface({
  center,
  zoom,
  width,
  height,
}: {
  center: LatLng;
  zoom: number;
  width: number;
  height: number;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <MapView
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
      provider={mapViewProviderProp(Platform.OS)}
      userInterfaceStyle={theme.scheme}
      initialRegion={regionForZoom(center, zoom, width, height)}
      scrollEnabled={false}
      zoomEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      showsUserLocation={false}
      showsMyLocationButton={false}
    />
  );
}

export type GoogleMapHandle = Pick<MapView, 'animateToRegion'>;

export function GoogleMapSurface({
  mapRef,
  initialRegion,
  onCenterChange,
}: {
  mapRef: React.RefObject<MapView | null>;
  initialRegion: Region;
  onCenterChange: (center: LatLng) => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        // Apple Maps on iOS (default provider, no key); Google on Android.
        provider={mapViewProviderProp(Platform.OS)}
        userInterfaceStyle={theme.scheme}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        onRegionChangeComplete={(region) =>
          onCenterChange({ lat: region.latitude, lng: region.longitude })
        }
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
      />
      {/* Fixed centre pin — the point that gets saved, lifted so its tip sits on
          the exact centre of the map. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          name="location"
          size={iconSize.xxl}
          color={theme.color.brand}
          style={{ marginTop: -iconSize.xxl / 2 }}
        />
      </View>
    </View>
  );
}
