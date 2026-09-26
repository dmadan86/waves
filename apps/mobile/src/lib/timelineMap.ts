/**
 * A non-throwing gate to the timeline's native map, the same way `nativeMaps`
 * gates the location picker's: `react-native-maps` throws at load on a binary
 * built without it, so the surface is reached only through a guarded `require`.
 * `null` means "no native map here" and the screen says so instead of crashing.
 */

import type { TimelineMapSurface as TimelineMapSurfaceType } from '@/components/timeline/TimelineMapSurface';

function load(): typeof TimelineMapSurfaceType | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/components/timeline/TimelineMapSurface') as unknown as {
      TimelineMapSurface?: typeof TimelineMapSurfaceType;
    };
    return typeof mod.TimelineMapSurface === 'function' ? mod.TimelineMapSurface : null;
  } catch {
    return null;
  }
}

export const TimelineMapNative: typeof TimelineMapSurfaceType | null = load();
