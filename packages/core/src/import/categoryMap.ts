/**
 * Other apps' category names, onto ours.
 *
 * Splitwise says "Dining out", "Bus/train", "Heat/gas"; a sheet says whatever
 * its owner thought of. Ten categories is a coarse net, so an unrecognised name
 * (or a vague one like "General") returns null and the caller falls back to
 * guessing from the description.
 */

import { CategoryId, guessCategory } from '../category/categories';

const TABLE: ReadonlyArray<readonly [CategoryId, readonly string[]]> = [
  [
    CategoryId.Food,
    [
      'food and drink',
      'food',
      'dining out',
      'dining',
      'restaurant',
      'restaurants',
      'coffee',
      'meals',
      'meal',
      'lunch',
      'dinner',
      'breakfast',
      'snacks',
      'drinks',
      'liquor',
      'alcohol',
      'bar',
    ],
  ],
  [CategoryId.Groceries, ['groceries', 'grocery', 'supermarket']],
  [
    CategoryId.Travel,
    [
      'taxi',
      'bus train',
      'plane',
      'car',
      'gas fuel',
      'fuel',
      'petrol',
      'parking',
      'bicycle',
      'transport',
      'transportation',
      'travel',
      'flight',
      'flights',
      'train',
      'bus',
      'cab',
    ],
  ],
  [CategoryId.Stay, ['hotel', 'accommodation', 'lodging', 'stay']],
  [CategoryId.Shopping, ['shopping', 'clothing', 'clothes', 'electronics']],
  [
    CategoryId.Entertainment,
    ['entertainment', 'games', 'movies', 'music', 'sports', 'fun', 'activities', 'tickets'],
  ],
  [
    CategoryId.Home,
    [
      'home',
      'rent',
      'furniture',
      'household supplies',
      'household',
      'maintenance',
      'mortgage',
      'utilities',
      'electricity',
      'water',
      'heat gas',
      'trash',
      'tv phone internet',
      'internet',
      'cleaning',
      'services',
      'bills',
    ],
  ],
  [CategoryId.Health, ['health', 'medical expenses', 'medical', 'medicine', 'pharmacy', 'doctor']],
  [CategoryId.Gifts, ['gifts', 'gift']],
  [CategoryId.Other, ['other', 'misc', 'miscellaneous']],
];

const LOOKUP: ReadonlyMap<string, CategoryId> = new Map(
  TABLE.flatMap(([id, names]) => names.map((name) => [name, id] as const)),
);

const normaliseName = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Our category for another app's category name, or null if it is not recognised. */
export function mapCategoryName(raw: string | null | undefined): CategoryId | null {
  return raw ? (LOOKUP.get(normaliseName(raw)) ?? null) : null;
}

/** The raw name if it is recognised, else a guess from the description, else null. */
export function categoryFor(
  raw: string | null | undefined,
  description: string,
  country?: string | null,
): CategoryId | null {
  return mapCategoryName(raw) ?? guessCategory(description, country);
}
