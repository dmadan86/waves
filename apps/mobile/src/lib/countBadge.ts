/** Text for a count pill: null hides it, anything above 99 reads "99+". */
export function badgeLabel(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
}
