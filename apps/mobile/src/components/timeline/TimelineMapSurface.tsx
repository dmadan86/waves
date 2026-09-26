/**
 * The native map under "Your timeline": amount pills, merged bubbles, and the
 * day's route.
 *
 * Its own file for the reason `GoogleMapSurface` is: it imports
 * `react-native-maps`, whose JS throws on a binary built without the native
 * module. `lib/timelineMap.ts` reaches it through a guarded `require`, and the
 * screen says the map needs a newer app instead of crashing.
 *
 * It draws and reports, nothing more. What is on the map (the clusters, the
 * route, which pill is selected) is decided by `TimelineMap`, so the decisions
 * stay testable and this file stays a thin skin over the native view.
 */

import { View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { format, money, type CurrencyCode } from '@waves/core';
import { Text, useTheme } from '@waves/ui';

import type { MapRegion, PinCluster } from '@/lib/timeline';

export type TimelineMapHandle = Pick<
  MapView,
  'animateToRegion' | 'animateCamera' | 'fitToCoordinates'
>;

export interface TimelineMapSurfaceProps {
  mapRef: React.RefObject<TimelineMapHandle | null>;
  initialRegion: MapRegion;
  clusters: readonly PinCluster[];
  selectedId: string | null;
  /** The route, in time order. Partial while a replay is drawing it. */
  route: readonly { lat: number; lng: number }[];
  locale: string;
  onRegionChange: (region: MapRegion) => void;
  onPressCluster: (cluster: PinCluster) => void;
}

function amountLabel(amount: bigint, currency: string, locale: string): string {
  return format(money(amount, currency as CurrencyCode), { locale });
}

export function TimelineMapSurface({
  mapRef,
  initialRegion,
  clusters,
  selectedId,
  route,
  locale,
  onRegionChange,
  onPressCluster,
}: TimelineMapSurfaceProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <MapView
      ref={mapRef as React.RefObject<MapView>}
      provider={PROVIDER_GOOGLE}
      style={{ flex: 1 }}
      initialRegion={initialRegion as Region}
      onRegionChangeComplete={(region) => onRegionChange(region)}
      showsUserLocation={false}
      showsMyLocationButton={false}
      toolbarEnabled={false}
    >
      {route.length > 1 ? (
        <Polyline
          coordinates={route.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
          strokeColor={theme.color.brand}
          strokeWidth={4}
          lineCap="round"
          lineJoin="round"
        />
      ) : null}
      {clusters.map((cluster) => {
        const single = cluster.entries.length === 1 ? cluster.entries[0]! : null;
        const selected = single !== null && single.id === selectedId;
        const label = single
          ? amountLabel(single.amount, single.currency, locale)
          : cluster.total
            ? `${cluster.entries.length} · ${amountLabel(cluster.total.amount, cluster.total.currency, locale)}`
            : String(cluster.entries.length);
        return (
          <Marker
            // Remounted when what it shows changes, so the snapshot Android
            // takes of a custom marker is always of the current pill.
            key={`${cluster.id}:${cluster.entries.length}:${selected ? 1 : 0}`}
            coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
            anchor={{ x: 0.5, y: 1 }}
            zIndex={selected ? 10 : single ? 1 : 2}
            onPress={() => onPressCluster(cluster)}
          >
            <Pill label={label} selected={selected} bubble={single === null} />
          </Marker>
        );
      })}
    </MapView>
  );
}

/**
 * One pin: the amount in a pill with a small tail. White with ink when idle,
 * solid brand when selected, and the brand tint for a merged bubble — so the
 * three read apart even in a crowd.
 */
function Pill({
  label,
  selected,
  bubble,
}: {
  label: string;
  selected: boolean;
  bubble: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const fill = selected ? theme.color.brand : bubble ? theme.color.brandSoft : theme.color.surface;
  const ink = selected ? theme.color.onBrand : bubble ? theme.color.brand : theme.color.text;
  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          paddingHorizontal: selected ? 12 : 10,
          paddingVertical: selected ? 7 : 5,
          borderRadius: 999,
          backgroundColor: fill,
          borderWidth: selected ? 0 : 1,
          borderColor: theme.color.border,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
          elevation: 3,
        }}
      >
        <Text variant="caption" style={{ color: ink, fontWeight: '700' }} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: 5,
          borderRightWidth: 5,
          borderTopWidth: 6,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: fill,
          marginTop: -1,
        }}
      />
    </View>
  );
}
