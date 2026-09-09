/**
 * Which of the three things a backup needs is still missing, and which one the
 * person should be handed a button for.
 *
 * A backup needs a linked Drive account, a key on this device, and — the one
 * everybody forgets is a step — the person having actually kept a copy of that
 * key. Until all three are true the screen has nothing useful to offer except
 * the step that is outstanding.
 *
 * Two of the three are the engine's own refusals: `runBackup` returns
 * `not-connected` with no tokens and `no-key` with no key. The third is not.
 * `engine.ts` never reads `keySeen` — that gate is enforced by the two callers
 * instead, this screen and `AutoBackup.tsx`, because "have you written it
 * down?" is a question about a person and the engine only knows about bytes.
 * Which is exactly why it belongs on a checklist.
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

/** The three things, in the order the screen asks for them. */
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
 * Read the four flags as a checklist.
 *
 * `SaveKey` is reported done only when there is a key to have saved. `keySeen`
 * outliving its key is not reachable today — `acceptKey` sets both, and unlink
 * clears both — but a checklist that could claim "key saved" over "no key on
 * this phone" would be lying about the one thing this screen must not lie
 * about, so the conjunction is written down rather than assumed.
 */
export function backupSetup(input: BackupSetupInput): BackupSetupState {
  const steps: readonly BackupSetupStep[] = [
    { step: BackupStep.Account, done: input.configured && input.connected },
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
