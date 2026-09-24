/**
 * Switching from a guest to the account that already owns their Google or
 * Apple login, and taking the guest's groups along.
 *
 * The two accounts cannot be merged — Supabase refuses to link one identity to
 * two users — so this is a switch: sign in as the existing account, then join
 * it to every group the guest joined, through the same links. What the guest
 * added itself stays with the guest; the screen says so before anyone agrees.
 *
 * Plain functions with everything injected, so the order of it — links read
 * before the guest is signed out, since signing out may clear the phone — can
 * be pinned by a test without a phone.
 */

export interface SwitchDeps {
  readonly guestId: string;
  readJoins(guestId: string): Promise<string[]>;
  clearJoins(guestId: string): Promise<void>;
  /** Out of the guest and into the existing account. False: they backed out. */
  signInInstead(): Promise<boolean>;
  /** Join the now signed-in account through one link; the group it landed in. */
  accept(token: string): Promise<string | null>;
  report(error: unknown, where: string): void;
}

export type SwitchOutcome =
  | { readonly switched: false }
  | { readonly switched: true; readonly groupId: string | null; readonly failed: number };

export async function switchToExistingAccount(deps: SwitchDeps): Promise<SwitchOutcome> {
  // First, while the guest is still signed in: the sign-out that follows wipes
  // what this phone held for them.
  const tokens = await deps.readJoins(deps.guestId).catch(() => [] as string[]);

  if (!(await deps.signInInstead())) return { switched: false };

  let groupId: string | null = null;
  let failed = 0;
  // One at a time, and each on its own: a link that has since been reset must
  // not cost the others.
  for (const token of tokens) {
    try {
      const joined = await deps.accept(token);
      groupId ??= joined;
    } catch (error) {
      failed += 1;
      deps.report(error, 'auth.switchRejoin');
    }
  }
  await deps.clearJoins(deps.guestId).catch(() => {});
  return { switched: true, groupId, failed };
}
