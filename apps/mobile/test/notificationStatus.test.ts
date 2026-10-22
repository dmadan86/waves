import { describe, expect, it } from 'vitest';

import { notificationsRowStatus } from '@/lib/notificationStatus';
import type { PushPermission } from '@/lib/push';

const s = { rowOn: 'On', rowOff: 'Off', rowOffInPhone: 'Off in phone settings' };
const p = (v: string) => v as PushPermission;

describe('notificationsRowStatus', () => {
  it('maps the phone permission to a status', () => {
    expect(notificationsRowStatus(p('granted'), s)).toBe('On');
    expect(notificationsRowStatus(p('denied'), s)).toBe('Off in phone settings');
    expect(notificationsRowStatus(p('undetermined'), s)).toBe('Off');
  });
  it('shows nothing before the permission is read', () => {
    expect(notificationsRowStatus(null, s)).toBeUndefined();
  });
});
