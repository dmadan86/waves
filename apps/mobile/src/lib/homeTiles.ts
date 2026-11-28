/** Where Home's Family tile goes: the one family space, or the list when there are several. */
export function familyTileHref(ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  return ids.length === 1 ? `/group/${ids[0]}` : '/groups';
}
