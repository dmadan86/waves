/**
 * The big "Add …" call to action inside an empty list shows only while the
 * group has no entries at all. Once there is one, the regular add entry point
 * (hero pill, header button) is the only door. Entries hidden by a filter still
 * count: a filtered-to-nothing list is not an empty group.
 */
export function showEmptyAddCta(totalEntries: number): boolean {
  return totalEntries === 0;
}
