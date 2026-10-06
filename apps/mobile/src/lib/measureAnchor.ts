import type { RefObject } from 'react';
import type { View } from 'react-native';

/** Measure a view in window coordinates, then hand the result (null if it has
 *  no size or is not mounted) to `done` — for a menu that drops from it. */
export function measureAnchor(
  ref: RefObject<View | null>,
  done: (anchor: { x: number; y: number; width: number; height: number } | null) => void,
): void {
  const node = ref.current;
  if (!node) return done(null);
  node.measureInWindow((x, y, width, height) => done(width > 0 ? { x, y, width, height } : null));
}
