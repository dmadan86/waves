/**
 * Which JavaScript this phone is running — built into the store binary, or an
 * over-the-air update — formatted for Settings > App updates.
 *
 * Pure on purpose (no `expo-updates`, no React Native) so the mobile vitest run
 * can cover it; `lib/restart` is where the native module is read.
 */

export interface UpdateIdentity {
  /** `Updates.isEmbeddedLaunch` — true when the bundle came with the binary. */
  readonly embedded: boolean;
  readonly updateId: string | null;
  readonly createdAt: Date | null;
}

/** First 8 characters of an update id, enough to tell two updates apart. */
export function shortUpdateId(id: string | null | undefined): string {
  return id ? id.replace(/-/g, '').slice(0, 8) : '';
}

/** `2026-11-10` — numeric and locale-free, so it reads the same in every language. */
export function formatUpdateDate(date: Date | null | undefined): string {
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

/**
 * The detail line: the built-in label alone, or `Over-the-air · 1a2b3c4d · 2026-11-10`
 * with whichever of the id and date are known.
 */
export function describeUpdate(
  identity: UpdateIdentity,
  labels: { builtIn: string; overTheAir: string },
): string {
  if (identity.embedded) return labels.builtIn;
  return [labels.overTheAir, shortUpdateId(identity.updateId), formatUpdateDate(identity.createdAt)]
    .filter(Boolean)
    .join(' · ');
}
