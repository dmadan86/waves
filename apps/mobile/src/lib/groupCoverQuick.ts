/**
 * The ten quick icons on the group cover sheet: the everyday kinds of group,
 * each stored as the emoji a group of that kind has always carried (so the web
 * client and older builds read the pick), and each drawn on the sheet in its
 * own colour. The full catalogue sits behind "See all".
 */

import { MARK_FOR_EMOJI } from '../components/GroupMark';

export const QUICK_ICON_IDS = [
  'food',
  'travel',
  'home',
  'friends',
  'shopping',
  'event',
  'car',
  'wallet',
  'game',
  'other',
] as const;

export type QuickIconId = (typeof QUICK_ICONS)[number]['id'];

export const QUICK_ICONS = [
  { id: 'food', emoji: '🍽️', color: '#5B4FD8' },
  { id: 'travel', emoji: '✈️', color: '#3B82F6' },
  { id: 'home', emoji: '🏠', color: '#F97316' },
  { id: 'friends', emoji: '👥', color: '#22A06B' },
  { id: 'shopping', emoji: '🛒', color: '#EF4444' },
  { id: 'event', emoji: '🎉', color: '#EC4899' },
  { id: 'car', emoji: '🚗', color: '#3B82F6' },
  { id: 'wallet', emoji: '💰', color: '#6D5BE0' },
  { id: 'game', emoji: '🎮', color: '#F59E0B' },
  { id: 'other', emoji: '📌', color: '#8A90A0' },
] as const;

const strip = (emoji: string): string => emoji.replace(/️/g, '');

/**
 * Which quick tile a stored emoji lights, or null when it is one the full
 * catalogue offers instead. Two emoji that draw as the same mark (🚕 and 🚗)
 * count as the same pick, exactly as the full grid treats them.
 */
export function quickIconFor(value: string | null | undefined): QuickIconId | null {
  if (!value) return null;
  const v = strip(value);
  for (const quick of QUICK_ICONS) {
    const q = strip(quick.emoji);
    if (q === v) return quick.id;
    const a = MARK_FOR_EMOJI[v];
    if (a && a === MARK_FOR_EMOJI[q]) return quick.id;
  }
  return null;
}
