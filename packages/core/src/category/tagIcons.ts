/**
 * The glyphs a custom tag may wear (extends TDR §8).
 *
 * A wide, curated set of Ionicons — the everyday shapes of spending and earning
 * across food, travel, home, work, health, fun, people and money — not the whole
 * glyph map, which would be a wall of arrows and logos nobody tags a bill with.
 * All outline style, so they sit beside the built-in categories; grouped so the
 * picker reads in bands rather than as one undifferentiated grid.
 *
 * The list lives in core rather than in the app because it has two readers now.
 * The picker was the only writer of an icon for as long as a person choosing one
 * was the only way a tag could exist — so `/sync` accepted any string up to 64
 * characters, and nothing was ever wrong. A pack is a second writer, authored
 * somewhere else, and the first mistyped glyph in one would render as a blank
 * box on every device that installed it with nothing having said no. Validation
 * needs the list, the edge function needs the validation, and neither can import
 * from the React Native app — so the names are plain strings here, and the app
 * re-exports them typed against its own glyph map (which is what proves they are
 * real, in `apps/mobile/test/tagIcons.test.ts`).
 */

export const TAG_ICON_GROUPS: readonly (readonly string[])[] = [
  // Food & drink
  [
    'restaurant-outline',
    'fast-food-outline',
    'pizza-outline',
    'cafe-outline',
    'beer-outline',
    'wine-outline',
    'nutrition-outline',
    'ice-cream-outline',
    'egg-outline',
    'fish-outline',
  ],
  // Groceries & shopping
  [
    'cart-outline',
    'basket-outline',
    'bag-handle-outline',
    'pricetag-outline',
    'pricetags-outline',
    'shirt-outline',
    'gift-outline',
    'storefront-outline',
    'cube-outline',
    'balloon-outline',
  ],
  // Getting around
  [
    'car-outline',
    'car-sport-outline',
    'bus-outline',
    'train-outline',
    'subway-outline',
    'bicycle-outline',
    'boat-outline',
    'airplane-outline',
    'rocket-outline',
    'walk-outline',
  ],
  // Travel & stay
  [
    'bed-outline',
    'business-outline',
    'map-outline',
    'compass-outline',
    'earth-outline',
    'sunny-outline',
    'umbrella-outline',
    'camera-outline',
    'ticket-outline',
    'trail-sign-outline',
  ],
  // Home, bills & utilities
  [
    'home-outline',
    'bulb-outline',
    'flash-outline',
    'water-outline',
    'flame-outline',
    'wifi-outline',
    'call-outline',
    'tv-outline',
    'construct-outline',
    'hammer-outline',
    'trash-outline',
    'shield-checkmark-outline',
  ],
  // Work & study
  [
    'briefcase-outline',
    'laptop-outline',
    'desktop-outline',
    'print-outline',
    'document-text-outline',
    'school-outline',
    'book-outline',
    'library-outline',
    'calculator-outline',
    'mail-outline',
  ],
  // Health & fitness
  [
    'medkit-outline',
    'medical-outline',
    'fitness-outline',
    'barbell-outline',
    'heart-outline',
    'pulse-outline',
    'bandage-outline',
    'eye-outline',
    'flask-outline',
    'leaf-outline',
  ],
  // Fun & hobbies
  [
    'game-controller-outline',
    'musical-notes-outline',
    'headset-outline',
    'film-outline',
    'football-outline',
    'basketball-outline',
    'tennisball-outline',
    'golf-outline',
    'color-palette-outline',
    'brush-outline',
    'dice-outline',
    'planet-outline',
  ],
  // People, gifts & celebration
  [
    'people-outline',
    'person-outline',
    'happy-outline',
    'sparkles-outline',
    'ribbon-outline',
    'trophy-outline',
    'star-outline',
    'flower-outline',
    'paw-outline',
    'accessibility-outline',
  ],
  // Money & the rest
  [
    'card-outline',
    'cash-outline',
    'wallet-outline',
    'pie-chart-outline',
    'trending-up-outline',
    'receipt-outline',
    'time-outline',
    'calendar-outline',
    'key-outline',
    'ellipsis-horizontal-circle-outline',
  ],
];

/** The flat list the editor renders — every group, in order. */
export const TAG_ICONS: readonly string[] = TAG_ICON_GROUPS.flat();

/** The default a new tag starts on. */
export const DEFAULT_TAG_ICON = 'pricetag-outline';

const KNOWN = new Set<string>(TAG_ICONS);

/** Whether a name is one a picker can actually draw. The check a second writer
 *  of tags — a pack — has to pass. */
export function isTagIcon(name: unknown): name is string {
  return typeof name === 'string' && KNOWN.has(name);
}
