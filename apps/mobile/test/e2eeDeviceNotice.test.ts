import { describe, expect, it } from 'vitest';

import { diffDevices, memoryMeta, NoticeStore, type DeviceNotice } from '../src/e2ee/deviceNotice';

describe('diffDevices', () => {
  it('treats the first device list as a baseline', () => {
    expect(diffDevices(null, [{ deviceId: 'p1', memberId: 'partner' }], 'me')).toEqual([]);
  });

  it('ignores my devices and a partner’s first device, but flags their second', () => {
    const known = [
      { deviceId: 'me1', memberId: 'me' },
      { deviceId: 'partner1', memberId: 'partner' },
    ];
    const current = [
      ...known,
      { deviceId: 'me2', memberId: 'me' },
      { deviceId: 'new-member-phone', memberId: 'new-member' },
      { deviceId: 'partner2', memberId: 'partner' },
    ];
    expect(diffDevices(known, current, 'me')).toEqual([
      { deviceId: 'partner2', memberId: 'partner' },
    ]);
  });
});

describe('NoticeStore', () => {
  const notice = (groupId: string, deviceId: string): DeviceNotice => ({
    groupId,
    deviceId,
    memberId: 'partner',
  });

  it('adds, filters by group, persists dismissals across reloads, and clears', async () => {
    const meta = memoryMeta();
    const store = new NoticeStore(meta);
    const first = notice('group-a', 'phone-a');
    const second = notice('group-b', 'phone-b');

    await store.add([first, second]);
    expect(store.list()).toEqual([first, second]);
    expect(store.list('group-a')).toEqual([first]);

    await store.dismiss('phone-a');
    const reloaded = new NoticeStore(meta);
    await reloaded.load();
    expect(reloaded.list()).toEqual([second]);

    reloaded.clear();
    expect(reloaded.list()).toEqual([]);
  });
});
