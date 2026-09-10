/**
 * What is still missing before a backup can run, and which one thing the person
 * should be handed a button for.
 *
 * ## What changed, and why the list got shorter
 *
 * This used to be three steps for everybody: link an account, make a key, keep
 * a copy of the key. That was the right checklist for the only tier that
 * existed and the wrong checklist for the tier that should have been the
 * default. On **Standard** there is no key ceremony at all — the key is minted
 * silently and escrowed in the same hidden Drive folder as the backup — so
 * steps two and three are questions with no answer, and the whole list collapses
 * to the one thing that genuinely needs a person: linking the Google account.
 * Link, and it is done.
 *
 * On **Extra protection** all three steps are exactly what they were, in the
 * same order, with the same rules. That is not backwards compatibility for its
 * own sake: somebody on Extra really does have to be shown a key and really
 * does have to keep it, and the checklist is the honest way to say so.
 *
 * A one-item checklist is not a checklist, so the screen does not draw it as
 * one — `total` is 1 and it renders the button on its own. The counting still
 * happens here rather than in the screen because `complete` is the flag the
 * whole screen keys off, and it must mean the same thing in both tiers: *a
 * backup would actually run right now*.
 *
 * ## The rules that did not change
 *
 * Two of the steps are the engine's own refusals: `runBackup` returns
 * `not-connected` with no tokens and `no-key` with no key. The third is not.
 * `engine.ts` never reads `keySeen` — that gate is enforced by the two callers,
 * this screen and `AutoBackup.tsx`, because "have you written it down?" is a
 * question about a person and the engine only knows about bytes.
 *
 * The order is not cosmetic. Linking comes first because it is the only step
 * that can fail for reasons outside the app (no Play services, a cancelled
 * consent page), and finding that out after minting a key would leave a key on
 * a phone with nowhere to send it. Saving the key comes last because it is the
 * only step whose "done" is a claim by the person rather than a fact the app
 * can check — `keySeen` is a promise, not a proof, and a promise is worth
 * asking for only once there is something to promise about.
 *
 * This lives away from the screen so the branching can be tested without a
 * renderer, which the mobile vitest setup deliberately does not have.
 */

import { BackupTier } from './tier';

/** The things a backup needs, in the order the screen asks for them. */
export enum BackupStep {
  /** A Google account linked, so there is somewhere to put the file. */
  Account = 'account',
  /** A key on this device, so there is something to seal it with. */
  Key = 'key',
  /** The key written down somewhere that is not this phone. */
  SaveKey = 'save-key',
}

/** What the hook knows that bears on whether a backup can run. */
export interface BackupSetupInput {
  /** False when this build carries no OAuth client id for the provider. */
  readonly configured: boolean;
  readonly connected: boolean;
  readonly hasKey: boolean;
  readonly keySeen: boolean;
  readonly tier: BackupTier;
}

export interface BackupSetupStep {
  readonly step: BackupStep;
  readonly done: boolean;
}

export interface BackupSetupState {
  readonly steps: readonly BackupSetupStep[];
  /**
   * The first step not yet done — the only one the screen gives a button, so
   * there is never a choice about what to tap next. Null when everything is
   * done, and null when nothing can be done at all.
   */
  readonly outstanding: BackupStep | null;
  readonly done: number;
  readonly total: number;
  /** True when a backup would actually run. Everything on screen keys off it. */
  readonly complete: boolean;
  /** No client id in this build: the steps are not the person's to take. */
  readonly unavailable: boolean;
}

/**
 * Read the flags as a checklist.
 *
 * On Extra, `SaveKey` is reported done only when there is a key to have saved.
 * `keySeen` outliving its key is not reachable today — `acceptKey` sets both,
 * and unlink clears both — but a checklist that could claim "key saved" over
 * "no key on this phone" would be lying about the one thing this screen must
 * not lie about, so the conjunction is written down rather than assumed.
 *
 * On Standard the key steps are absent rather than pre-ticked. A step that
 * ticks itself the moment it appears is noise on a screen whose whole problem
 * was scaffolding that had outlived its purpose — and worse, it would imply the
 * person did something they did not do.
 */
export function backupSetup(input: BackupSetupInput): BackupSetupState {
  const linked = input.configured && input.connected;
  const steps: readonly BackupSetupStep[] =
    input.tier === BackupTier.Standard
      ? [{ step: BackupStep.Account, done: linked }]
      : [
          { step: BackupStep.Account, done: linked },
          { step: BackupStep.Key, done: input.hasKey },
          { step: BackupStep.SaveKey, done: input.hasKey && input.keySeen },
        ];
  const done = steps.filter((entry) => entry.done).length;
  const complete = input.configured && done === steps.length;
  return {
    steps,
    outstanding: input.configured
      ? (steps.find((entry) => !entry.done)?.step ?? null)
      : // Nothing to point at: no tap on this screen changes a missing client
        // id, so the screen says so once instead of offering a dead button.
        null,
    done,
    total: steps.length,
    complete,
    unavailable: !input.configured,
  };
}
