/**
 * Which build this is — the line at the bottom of Settings.
 *
 * Two builds of the same version are identical from the outside: same name,
 * same version, and the same `versionCode` whenever nobody remembered to bump
 * it. So the only way to answer "is the fix in the build on this phone?" was to
 * go and try to reproduce the bug, and a wrong guess there is expensive in both
 * directions — a fixed bug reported as still broken, or a broken one waved
 * through because the last build was fine.
 *
 * The stamp answers it outright: `1.0.0 (5) · 4f2c9ab`. The commit is the part
 * that actually settles it, since it changes with every build whether or not
 * anybody edited a version number.
 *
 * Only the formatting lives here, with no import of React Native or
 * `expo-constants`, so it can be tested in the mobile vitest run (which renders
 * nothing and cannot load the native modules). Reading the three values off the
 * running binary is `lib/buildIdentity`.
 */

export interface BuildIdentity {
  /** `expo.version` — the name people see, e.g. `1.0.0`. */
  readonly version: string | null;
  /** Android `versionCode` / iOS `buildNumber`, as text. */
  readonly build: string | null;
  /** Short commit hash, injected by `app.config.ts` at build time. */
  readonly commit: string | null;
}

/**
 * The stamp, or an empty string when nothing at all is known.
 *
 * Every part is optional and each is dropped cleanly: a checkout with no git
 * directory has no commit, and a config with no `versionCode` has no build
 * number. An empty string renders as nothing rather than as a stray separator.
 */
export function formatBuildStamp(identity: BuildIdentity): string {
  const version = identity.version?.trim();
  const build = identity.build?.trim();
  const commit = identity.commit?.trim();

  const head = [version, build ? `(${build})` : null].filter(Boolean).join(' ');
  return [head || null, commit || null].filter(Boolean).join(' · ');
}
