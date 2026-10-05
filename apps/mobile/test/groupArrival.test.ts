/**
 * When a group missing from the mirror is still worth waiting for.
 *
 * "Group not found" was shown to people who had joined a second earlier, because
 * the screen judged the mirror before the pull that fills it had happened.
 */

import { describe, expect, it } from 'vitest';

import {
  ARRIVAL_WINDOW_MS,
  expectGroup,
  expectedGroupRemaining,
  forgetExpectedGroup,
  groupMayStillArrive,
} from '@/lib/groupArrival';

const base = { found: false, hydrated: true, hasSynced: true, status: 'idle', expecting: false };

describe('groupMayStillArrive', () => {
  it('never waits for a group that is already there', () => {
    expect(groupMayStillArrive({ ...base, found: true, expecting: true })).toBe(false);
  });

  it('waits for a group the join flow expects', () => {
    expect(groupMayStillArrive({ ...base, expecting: true })).toBe(true);
  });

  it('waits through a session first sync that has not landed', () => {
    expect(groupMayStillArrive({ ...base, hasSynced: false })).toBe(true);
    expect(groupMayStillArrive({ ...base, hasSynced: false, status: 'syncing' })).toBe(true);
  });

  it('gives up once the first sync has failed, gone offline or been held', () => {
    for (const status of ['error', 'offline', 'metered']) {
      expect(groupMayStillArrive({ ...base, hasSynced: false, status })).toBe(false);
    }
  });

  it('does not wait on a synced session with nothing expected', () => {
    expect(groupMayStillArrive(base)).toBe(false);
  });

  it('does not judge before the disk is read', () => {
    expect(groupMayStillArrive({ ...base, hydrated: false, hasSynced: false })).toBe(false);
  });
});

describe('expected groups', () => {
  it('are waited for only within the window', () => {
    expectGroup('g1', 1_000);
    expect(expectedGroupRemaining('g1', 1_000 + 4_000)).toBe(ARRIVAL_WINDOW_MS - 4_000);
    expect(expectedGroupRemaining('g1', 1_000 + ARRIVAL_WINDOW_MS)).toBe(0);
    expect(expectedGroupRemaining('g1', 1_000 + 1)).toBe(0);
  });

  it('can be forgotten when the group arrives', () => {
    expectGroup('g2', 5_000);
    forgetExpectedGroup('g2');
    expect(expectedGroupRemaining('g2', 5_001)).toBe(0);
  });
});
