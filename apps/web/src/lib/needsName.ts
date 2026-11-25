/** The sign-in trigger's placeholder; nobody chose it as a name. */
export const PLACEHOLDER_NAME = 'Guest';

/** True when a signed-in (non-guest) profile still has no name a person chose. */
export function needsName(displayName: string | null | undefined): boolean {
  const name = (displayName ?? '').trim();
  return name === '' || name === PLACEHOLDER_NAME;
}
