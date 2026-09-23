/**
 * The battery warning is shown only where the manufacturer is known to stop
 * background work — a warning everybody sees is a warning nobody reads.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  os: 'android',
  manufacturer: null as string | null,
  throwOnRead: false,
  openSettings: vi.fn(async () => {}),
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return h.os;
    },
  },
  Linking: { openSettings: h.openSettings },
}));
vi.mock('expo-device', () => ({
  get manufacturer() {
    if (h.throwOnRead) throw new Error('no device info');
    return h.manufacturer;
  },
}));

const { batteryLimitsLikely, deviceMaker, openAppSettings } = await import('@/lib/smsBattery');

beforeEach(() => {
  h.os = 'android';
  h.manufacturer = null;
  h.throwOnRead = false;
  h.openSettings.mockReset();
});

describe('batteryLimitsLikely', () => {
  it('warns on manufacturers that stop scheduled work, however they spell themselves', () => {
    for (const maker of ['Xiaomi', 'XIAOMI', 'Redmi', ' samsung ', 'OnePlus', 'vivo']) {
      h.manufacturer = maker;
      expect(batteryLimitsLikely()).toBe(true);
    }
  });

  it('stays quiet on phones without the behaviour, and when the maker is unknown', () => {
    for (const maker of ['Google', 'Nothing', 'motorola', 'Sony', '', null]) {
      h.manufacturer = maker;
      expect(batteryLimitsLikely()).toBe(false);
    }
  });

  it('never warns off Android, and never throws when the device cannot say', () => {
    h.manufacturer = 'Xiaomi';
    h.os = 'ios';
    expect(batteryLimitsLikely()).toBe(false);

    h.os = 'android';
    h.throwOnRead = true;
    expect(batteryLimitsLikely()).toBe(false);
  });
});

describe('deviceMaker', () => {
  it('names the maker as the device reports it, trimmed', () => {
    h.manufacturer = '  Xiaomi ';
    expect(deviceMaker()).toBe('Xiaomi');
  });

  it('is null when there is nothing to name or the read throws', () => {
    h.manufacturer = '  ';
    expect(deviceMaker()).toBeNull();
    h.manufacturer = null;
    expect(deviceMaker()).toBeNull();
    h.throwOnRead = true;
    expect(deviceMaker()).toBeNull();
  });
});

describe('openAppSettings', () => {
  it('says whether the settings page actually opened', async () => {
    h.openSettings.mockResolvedValueOnce(undefined);
    expect(await openAppSettings()).toBe(true);

    h.openSettings.mockRejectedValueOnce(new Error('no activity'));
    expect(await openAppSettings()).toBe(false);
  });
});
