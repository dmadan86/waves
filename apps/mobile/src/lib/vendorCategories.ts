/** Pure helpers for a vendor's category list (the DB allows up to 10, each 1-40 characters, no case-insensitive duplicates). */
export const MAX_VENDOR_CATEGORIES = 10;
export const MAX_VENDOR_CATEGORY_LENGTH = 40;

const has = (list: readonly string[], name: string): boolean =>
  list.some((c) => c.toLowerCase() === name.toLowerCase());

/** Add a typed category: trimmed, ignored when empty, a duplicate or past the limit. */
export function addCategory(list: readonly string[], raw: string): string[] {
  const name = raw.trim().slice(0, MAX_VENDOR_CATEGORY_LENGTH).trim();
  if (!name || has(list, name) || list.length >= MAX_VENDOR_CATEGORIES) return [...list];
  return [...list, name];
}

export function removeCategory(list: readonly string[], name: string): string[] {
  return list.filter((c) => c.toLowerCase() !== name.toLowerCase());
}

/** A tile or chip tap: remove it when chosen, add it when not. */
export function toggleCategory(list: readonly string[], name: string): string[] {
  return has(list, name) ? removeCategory(list, name) : addCategory(list, name);
}

/** The tiles of the picker: presets, then (when expanded) more presets and the company's own, without repeats. */
export function categoryOptions(
  presets: readonly string[],
  more: readonly string[],
  used: readonly (readonly string[])[],
  expanded: boolean,
): string[] {
  if (!expanded) return [...presets];
  let out: string[] = [];
  for (const name of [...presets, ...more, ...used.flat()]) out = addCategoryRaw(out, name);
  return out;
}
const addCategoryRaw = (list: string[], name: string): string[] => {
  const n = name.trim();
  return n && !has(list, n) ? [...list, n] : list;
};
