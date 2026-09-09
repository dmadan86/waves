/**
 * The checklist behind the backup screen. What is worth pinning down is not
 * the happy path but the three states that produced the "doesn't seem to work"
 * report: a linked account with no key, a key nobody has confirmed keeping, and
 * a build with no client id at all — where the screen must offer nothing rather
 * than a button that cannot work.
 */

import { describe, expect, it } from 'vitest';

import { backupSetup, BackupStep } from '../src/lib/backup/setup';

const setup = backupSetup;

describe('nothing set up yet', () => {
  it('points at the account first, because linking can fail on its own', () => {
    const state = setup({ configured: true, connected: false, hasKey: false, keySeen: false });
    expect(state.outstanding).toBe(BackupStep.Account);
    expect(state.done).toBe(0);
    expect(state.total).toBe(3);
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
