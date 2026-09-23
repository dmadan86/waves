/**
 * What the automatic reader remembers between launches.
 *
 * Every read here fails towards "not armed, never checked": storage refusing
 * to answer must never switch on a feature that was off, or claim a read that
 * never happened.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  armAutoRead,
  backgroundCheckWanted,
  clearAutoReadState,
  disarmAutoRead,
  loadArmedOwner,
  loadLastCheckedAt,
  noteSmsPermissionGranted,
  onSmsPermissionGranted,
  saveBackgroundCheckWanted,
  saveLastCheckedAt,
} from '@/lib/smsAutoReadStore';

beforeEach(async () => {
  vi.restoreAllMocks();
  await AsyncStorage.clear();
});

describe('lastCheckedAt', () => {
  it('is null for an account that has never been read, and for no account at all', async () => {
    expect(await loadLastCheckedAt('alice')).toBeNull();
    await saveLastCheckedAt('', '2026-03-10T09:00:00.000Z');
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect(await loadLastCheckedAt('')).toBeNull();
  });

  it('round-trips per account, so a shared phone never reports one person’s read to another', async () => {
    await saveLastCheckedAt('alice', '2026-03-10T09:00:00.000Z');

    expect(await loadLastCheckedAt('alice')).toBe('2026-03-10T09:00:00.000Z');
    expect(await loadLastCheckedAt('bob')).toBeNull();
  });

  it('normalises a stored instant and reads garbage as never checked', async () => {
    await AsyncStorage.setItem(
      'waves.sms_auto_read.last_checked_at.alice',
      '2026-03-10T14:30:00+05:30',
    );
    expect(await loadLastCheckedAt('alice')).toBe('2026-03-10T09:00:00.000Z');

    await AsyncStorage.setItem('waves.sms_auto_read.last_checked_at.alice', 'last tuesday');
    expect(await loadLastCheckedAt('alice')).toBeNull();
  });

  it('reads a storage failure as never checked, and swallows a failed write', async () => {
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('locked'));
    expect(await loadLastCheckedAt('alice')).toBeNull();

    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(saveLastCheckedAt('alice', '2026-03-10T09:00:00.000Z')).resolves.toBeUndefined();
  });
});

describe('the armed record', () => {
  it('is nobody until an account passes every gate, and nobody again once disarmed', async () => {
    expect(await loadArmedOwner()).toBeNull();

    await armAutoRead('alice');
    expect(await loadArmedOwner()).toBe('alice');

    await disarmAutoRead();
    expect(await loadArmedOwner()).toBeNull();
  });

  it('never arms an empty account, and treats a blank record as nobody', async () => {
    await armAutoRead('');
    expect(await loadArmedOwner()).toBeNull();

    await AsyncStorage.setItem('waves.sms_auto_read.armed', '   ');
    expect(await loadArmedOwner()).toBeNull();
  });

  it('reads a storage failure as not armed', async () => {
    await armAutoRead('alice');
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('locked'));
    expect(await loadArmedOwner()).toBeNull();
  });

  it('survives storage refusing the write or the removal', async () => {
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(armAutoRead('alice')).resolves.toBeUndefined();
    vi.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('locked'));
    await expect(disarmAutoRead()).resolves.toBeUndefined();
  });
});

describe('the hourly check preference', () => {
  it('is wanted until somebody turns it off, and remembers either answer', async () => {
    expect(await backgroundCheckWanted()).toBe(true);

    await saveBackgroundCheckWanted(false);
    expect(await backgroundCheckWanted()).toBe(false);

    await saveBackgroundCheckWanted(true);
    expect(await backgroundCheckWanted()).toBe(true);
  });

  it('falls back to wanted when storage cannot answer, and keeps the default when a write fails', async () => {
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('locked'));
    expect(await backgroundCheckWanted()).toBe(true);

    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await saveBackgroundCheckWanted(false);
    expect(await backgroundCheckWanted()).toBe(true);
  });
});

describe('erasing an account', () => {
  it('disarms and forgets that account’s clock but leaves another account’s', async () => {
    await armAutoRead('alice');
    await saveLastCheckedAt('alice', '2026-03-10T09:00:00.000Z');
    await saveLastCheckedAt('bob', '2026-03-09T09:00:00.000Z');

    await clearAutoReadState('alice');

    expect(await loadArmedOwner()).toBeNull();
    expect(await loadLastCheckedAt('alice')).toBeNull();
    expect(await loadLastCheckedAt('bob')).toBe('2026-03-09T09:00:00.000Z');
  });

  it('still disarms when there is no account to scope the clock by', async () => {
    await armAutoRead('alice');
    await clearAutoReadState('');
    expect(await loadArmedOwner()).toBeNull();
  });

  it('does not fail when storage refuses to remove the clock', async () => {
    vi.spyOn(AsyncStorage, 'removeItem')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('locked'));
    await expect(clearAutoReadState('alice')).resolves.toBeUndefined();
  });
});

describe('the permission-granted signal', () => {
  it('tells every listener, and stops telling one that unsubscribed', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onSmsPermissionGranted(first);
    const stopSecond = onSmsPermissionGranted(second);

    noteSmsPermissionGranted();
    stopFirst();
    noteSmsPermissionGranted();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
  });

  it('keeps going past a listener that throws', () => {
    const after = vi.fn();
    const stopBad = onSmsPermissionGranted(() => {
      throw new Error('reader could not start');
    });
    const stopAfter = onSmsPermissionGranted(after);

    expect(() => noteSmsPermissionGranted()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    stopBad();
    stopAfter();
  });
});
