/**
 * The order behind the quick sheet's five chips.
 *
 * This is a preference store, not ledger state, so what has to hold is small
 * and entirely about ordering: the last place you filed to comes first, filing
 * somewhere twice does not give it two chips, the list cannot grow without
 * bound, and the order survives a cold start. The one race worth pinning is a
 * save that lands before the first disk read returns — the save is newer than
 * anything on disk, and an older stored order must not overwrite it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __resetRecentDestinationsForTest,
  destinationGroupId,
  groupDestination,
  loadRecentDestinations,
  noteDestination,
  PERSONAL_DESTINATION,
  recentDestinations,
  subscribeRecentDestinations,
  withMostRecent,
  type DestinationKey,
} from '../src/lib/recentDestinations';

beforeEach(async () => {
  __resetRecentDestinationsForTest();
  await AsyncStorage.clear();
});

describe('a destination key', () => {
  it('carries the group it names, and gives it back', () => {
    expect(destinationGroupId(groupDestination('abc'))).toBe('abc');
  });

  it('is not a group when it is the private ledger', () => {
    // The sheet branches on this: a group is an expense write, `personal` is a
    // different table entirely.
    expect(destinationGroupId(PERSONAL_DESTINATION)).toBeNull();
  });
});

describe('the order', () => {
  it('puts the last place you filed to first', async () => {
    await loadRecentDestinations();
    noteDestination(groupDestination('flat'));
    noteDestination(groupDestination('goa'));
    expect(recentDestinations()).toEqual([groupDestination('goa'), groupDestination('flat')]);
  });

  it('does not give one group two chips', async () => {
    await loadRecentDestinations();
    noteDestination(groupDestination('flat'));
    noteDestination(groupDestination('goa'));
    noteDestination(groupDestination('flat'));
    expect(recentDestinations()).toEqual([groupDestination('flat'), groupDestination('goa')]);
  });

  it('keeps more than the sheet shows, but not everything', () => {
    // Deeper than the five chips so that when the top few no longer resolve —
    // left, archived, deleted — there is still a full row behind them.
    let keys: readonly DestinationKey[] = [];
    for (let i = 0; i < 40; i += 1) keys = withMostRecent(keys, groupDestination(`g${i}`));
    expect(keys).toHaveLength(20);
    expect(keys[0]).toBe(groupDestination('g39'));
  });

  it('records the private ledger like anywhere else', async () => {
    await loadRecentDestinations();
    noteDestination(PERSONAL_DESTINATION);
    expect(recentDestinations()[0]).toBe(PERSONAL_DESTINATION);
  });

  it('ignores a group with no id', async () => {
    await loadRecentDestinations();
    noteDestination(groupDestination(''));
    expect(recentDestinations()).toEqual([]);
  });

  it('tells its subscribers', async () => {
    await loadRecentDestinations();
    const heard = vi.fn();
    const stop = subscribeRecentDestinations(heard);
    noteDestination(groupDestination('flat'));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    noteDestination(groupDestination('goa'));
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('across a restart', () => {
  it('still knows where you were filing', async () => {
    await loadRecentDestinations();
    noteDestination(groupDestination('flat'));
    noteDestination(groupDestination('goa'));

    __resetRecentDestinationsForTest();
    await loadRecentDestinations();

    expect(recentDestinations()).toEqual([groupDestination('goa'), groupDestination('flat')]);
  });

  it('reads nothing out of a corrupt value', async () => {
    await AsyncStorage.setItem('recent.destinations', '{not json');
    await loadRecentDestinations();
    expect(recentDestinations()).toEqual([]);
  });

  it('drops a stored key that is neither a group nor the private ledger', async () => {
    // A key shape this build does not know is a key a newer build wrote. It is
    // skipped rather than trusted: the sheet would have nothing to resolve it
    // against, and a chip that resolves to nothing is a chip that does nothing.
    await AsyncStorage.setItem(
      'recent.destinations',
      JSON.stringify(['group:flat', 'planet:mars', 42]),
    );
    await loadRecentDestinations();
    expect(recentDestinations()).toEqual([groupDestination('flat')]);
  });

  it('does not let the disk undo a save that beat it', async () => {
    await AsyncStorage.setItem('recent.destinations', JSON.stringify([groupDestination('old')]));

    // A save lands first — the sheet was used before the read returned.
    noteDestination(groupDestination('new'));
    await loadRecentDestinations();

    expect(recentDestinations()).toEqual([groupDestination('new')]);
  });
});
