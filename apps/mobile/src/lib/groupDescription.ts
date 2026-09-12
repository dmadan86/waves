/**
 * What a group's description is allowed to be, in one place.
 *
 * The column is plain `text` with a CHECK on its length, the `/sync` boundary
 * normalises what reaches it, and two screens type into it. Three places that
 * have to agree on the same number is how a cap drifts, so the number lives
 * here and the screens read it — the database constraint is the one copy that
 * cannot import this, and it names this file so the pair stays findable.
 *
 * 280 is chosen, not inherited. A description answers "what is this group" —
 * "Goa, Jan 2026, the four of us, flights already settled" — and that is a
 * sentence or two. Long enough that nobody has to abbreviate; short enough that
 * it stays a caption under the name rather than becoming a notes field the
 * group screen would then have to find room to show in full.
 */
export const GROUP_DESCRIPTION_MAX = 280;

/**
 * A typed description as the column should hold it: trimmed, capped, and NULL
 * rather than empty.
 *
 * The NULL matters and is the same bargain `name` strikes: '' renders as a blank
 * line everywhere a description is shown, where NULL renders as nothing at all.
 * Clearing the field has to reach the column as an absence, not as an empty
 * string that every reader then has to remember to treat as one.
 *
 * The cap is applied here as well as by `maxLength` on the input, because the
 * input is not the only writer — a clone seeds this field from another group's
 * row, and a row written before the cap existed would otherwise walk straight
 * into the CHECK constraint and be refused as an unexplained save failure.
 */
export function normaliseGroupDescription(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, GROUP_DESCRIPTION_MAX);
}
