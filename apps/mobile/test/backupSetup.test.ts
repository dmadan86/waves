/**
 * The checklist behind the backup screen. What is worth pinning down is not
 * the happy path but the three states that produced the "doesn't seem to work"
 * report: a linked account with no key, a key nobody has confirmed keeping, and
 * a build with no client id at all — where the screen must offer nothing rather
 * than a button that cannot work.
 */

import { describe, expect, it } from 'vitest';

import { backupSetup, BackupStep, type BackupSetupInput } from '../src/lib/backup/setup';
import { BackupTier } from '../src/lib/backup/tier';

/**
 * Everything below without a tier of its own is about Extra protection, whose
 * checklist is the three-step one this module has always had — and which every
 * account made under the build before tiers is now on. Standard has its own
 * block at the bottom.
 */
const setup = (input: Omit<BackupSetupInput, 'tier'>) =>
  backupSetup({ ...input, tier: BackupTier.Extra });

describe('the order of the steps', () => {
  it('is account, then key, then saving it, whatever the flags say', () => {
    // The order is the module's central claim — the reason it exists rather
    // than the screen branching inline — so it is asserted directly, and on a
    // state where the flags would not produce it by accident.
    const state = setup({ configured: true, connected: false, hasKey: true, keySeen: true });
    expect(state.steps.map((entry) => entry.step)).toEqual([
      BackupStep.Account,
      BackupStep.Key,
      BackupStep.SaveKey,
    ]);
  });
});

describe('nothing set up yet', () => {
  it('points at the account first, because linking can fail on its own', () => {
    const state = setup({ configured: true, connected: false, hasKey: false, keySeen: false });
    expect(state.outstanding).toBe(BackupStep.Account);
    expect(state.done).toBe(0);
    expect(state.total).toBe(3);
    expect(state.complete).toBe(false);
  });
});

describe('a link that died under a key that did not', () => {
  // Reachable on every `auth` refusal: the engine drops the dead tokens and
  // `useBackup` re-reads, leaving a phone that still holds its key with nothing
  // linked. Two of three done, and the outstanding one is the *first* gap, not
  // the last — a checklist that walked forward from the count would point at
  // the wrong step here.
  const state = setup({ configured: true, connected: false, hasKey: true, keySeen: true });

  it('counts two done but asks for the account again', () => {
    expect(state.done).toBe(2);
    expect(state.outstanding).toBe(BackupStep.Account);
    expect(state.complete).toBe(false);
  });
});

describe('linked, but no key — the state that was reported as broken', () => {
  const state = setup({ configured: true, connected: true, hasKey: false, keySeen: false });

  it('counts the link and points at the key', () => {
    expect(state.done).toBe(1);
    expect(state.outstanding).toBe(BackupStep.Key);
  });

  it('is not complete, so nothing on the screen may claim a backup will run', () => {
    expect(state.complete).toBe(false);
  });
});

describe('a key made and then dismissed without confirming', () => {
  const state = setup({ configured: true, connected: true, hasKey: true, keySeen: false });

  it('points at saving it, not at making another one', () => {
    expect(state.outstanding).toBe(BackupStep.SaveKey);
    expect(state.done).toBe(2);
    expect(state.complete).toBe(false);
  });
});

describe('all three done', () => {
  const state = setup({ configured: true, connected: true, hasKey: true, keySeen: true });

  it('has nothing outstanding and settles into an ordinary settings screen', () => {
    expect(state.outstanding).toBeNull();
    expect(state.done).toBe(3);
    expect(state.complete).toBe(true);
    expect(state.unavailable).toBe(false);
  });
});

describe('a key-seen flag with no key behind it', () => {
  it('never reports the key as saved — the screen must not claim what is gone', () => {
    const state = setup({ configured: true, connected: true, hasKey: false, keySeen: true });
    expect(state.steps.find((entry) => entry.step === BackupStep.SaveKey)?.done).toBe(false);
    expect(state.outstanding).toBe(BackupStep.Key);
  });
});

describe('a build with no OAuth client id', () => {
  const state = setup({ configured: false, connected: false, hasKey: false, keySeen: false });

  it('offers no step, because no tap here changes it', () => {
    expect(state.unavailable).toBe(true);
    expect(state.outstanding).toBeNull();
    expect(state.complete).toBe(false);
  });

  it('does not credit a link that the build could not have made', () => {
    const stale = setup({ configured: false, connected: true, hasKey: true, keySeen: true });
    expect(stale.steps[0]?.done).toBe(false);
    expect(stale.complete).toBe(false);
    expect(stale.outstanding).toBeNull();
  });
});

describe('Standard, where there is no key ceremony at all', () => {
  const standard = (connected: boolean, configured = true) =>
    backupSetup({
      configured,
      connected,
      // Deliberately the flags that would make the old checklist say "two of
      // three done": on Standard neither of them is a step, and neither may
      // count towards anything.
      hasKey: false,
      keySeen: false,
      tier: BackupTier.Standard,
    });

  it('asks for one thing, and it is the account', () => {
    const state = standard(false);
    expect(state.steps.map((entry) => entry.step)).toEqual([BackupStep.Account]);
    expect(state.outstanding).toBe(BackupStep.Account);
    expect(state.total).toBe(1);
    expect(state.done).toBe(0);
  });

  it('is complete the moment the account is linked, with no key on the phone', () => {
    // The whole point of the tier. Under the old checklist this same state was
    // "one of three" and every control on the screen was inert.
    const state = standard(true);
    expect(state.complete).toBe(true);
    expect(state.outstanding).toBeNull();
    expect(state.done).toBe(1);
  });

  it('never mentions a key, even on a phone that happens to hold one', () => {
    // True after the first backup: the engine mints a key and escrows it. It is
    // not a step, it was not asked for, and a checklist that ticked it would be
    // claiming credit for something the person did not do.
    const state = backupSetup({
      configured: true,
      connected: true,
      hasKey: true,
      keySeen: false,
      tier: BackupTier.Standard,
    });
    expect(state.steps.map((entry) => entry.step)).toEqual([BackupStep.Account]);
    expect(state.complete).toBe(true);
  });

  it('still offers nothing in a build with no client id', () => {
    const state = standard(false, false);
    expect(state.unavailable).toBe(true);
    expect(state.outstanding).toBeNull();
    expect(state.complete).toBe(false);
  });
});
