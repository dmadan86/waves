import type { ActionColor } from '@/lib/allActions';

/**
 * The "All actions" tile palette: one mid-tone per tile, readable on light and dark surfaces.
 * The tile's icon square is this colour at TILE_TINT alpha over the theme surface, so dark mode
 * needs no second set.
 */
export const ACTION_COLORS: Record<ActionColor, string> = {
  purple: '#7C5CFC',
  green: '#1F9D55',
  orange: '#F08A0B',
  coral: '#EF5B3A',
  blue: '#2F7CF6',
  teal: '#0FA3A3',
  pink: '#E0458A',
  indigo: '#4F55D9',
  amber: '#D99A00',
  red: '#E5484D',
};

/** 10% tint, as a hex alpha suffix. */
export const TILE_TINT = '1A';
