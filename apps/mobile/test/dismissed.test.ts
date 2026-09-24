/**
 * The memory behind closable notes: a closed note stays closed, per note and
 * per account, and storage that refuses to answer never hides a note for good
 * or breaks the close.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dismissedKey, isDismissed, rememberDismissed, useDismissed } from '../src/lib/dismissed';
import { act, flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const ALICE = 'user-alice';
const BOB = 'user-bob';

beforeEach(async () => {
  await AsyncStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the dismissed flag', () => {
  it('is namespaced by note and account', () => {
    expect(dismissedKey('notifications.neverSpam', ALICE)).toBe(
      'dismissed:callout:notifications.neverSpam:user-alice',
    );
    expect(dismissedKey('notifications.neverSpam', null)).toBe(
      'dismissed:callout:notifications.neverSpam:device',
    );
  });

  it('reads back what was written, for that note and that account only', async () => {
    await rememberDismissed('notifications.neverSpam', ALICE);

    expect(await isDismissed('notifications.neverSpam', ALICE)).toBe(true);
    expect(await isDismissed('notifications.neverSpam', BOB)).toBe(false);
    expect(await isDismissed('account.guestReassurance', ALICE)).toBe(false);
  });

  it('reads an unreadable flag as "not closed"', async () => {
    await rememberDismissed('notifications.neverSpam', ALICE);
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));

    expect(await isDismissed('notifications.neverSpam', ALICE)).toBe(false);
  });

  it('swallows a failed write', async () => {
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));

    await expect(rememberDismissed('notifications.neverSpam', ALICE)).resolves.toBeUndefined();
  });
});

describe('useDismissed', () => {
  it('is undecided until the flag loads, then open for a note never closed', async () => {
    const hook = renderHook(() => useDismissed('notifications.neverSpam', ALICE));
    expect(hook.result.current.dismissed).toBeNull();

    await flush();
    expect(hook.result.current.dismissed).toBe(false);
  });

  it('closes at once and stays closed on the next mount', async () => {
    const first = renderHook(() => useDismissed('notifications.neverSpam', ALICE));
    await flush();

    act(() => first.result.current.dismiss());
    expect(first.result.current.dismissed).toBe(true);
    first.unmount();
    await flush();

    const second = renderHook(() => useDismissed('notifications.neverSpam', ALICE));
    await flush();
    expect(second.result.current.dismissed).toBe(true);

    const other = renderHook(() => useDismissed('notifications.neverSpam', BOB));
    await flush();
    expect(other.result.current.dismissed).toBe(false);
  });

  it('goes back to undecided when the account changes, then reads that account', async () => {
    await rememberDismissed('notifications.neverSpam', ALICE);
    const hook = renderHook((owner: string) => useDismissed('notifications.neverSpam', owner), {
      props: ALICE,
    });
    await flush();
    expect(hook.result.current.dismissed).toBe(true);

    hook.rerender(BOB);
    expect(hook.result.current.dismissed).toBeNull();
    await flush();
    expect(hook.result.current.dismissed).toBe(false);
  });

  it('shows the note when storage cannot be read', async () => {
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    const hook = renderHook(() => useDismissed('notifications.neverSpam', ALICE));
    await flush();

    expect(hook.result.current.dismissed).toBe(false);
  });

  it('still closes for this visit when the write fails', async () => {
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
    const hook = renderHook(() => useDismissed('notifications.neverSpam', ALICE));
    await flush();

    act(() => hook.result.current.dismiss());
    await flush();
    expect(hook.result.current.dismissed).toBe(true);
    expect(await isDismissed('notifications.neverSpam', ALICE)).toBe(false);
  });
});
