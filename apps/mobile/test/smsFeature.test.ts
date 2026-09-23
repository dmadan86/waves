/**
 * The gates in front of the inbox reader: platform, build, flag arm and
 * account. All of them, every time — and "the flag table has not answered yet"
 * kept apart from "no", because the automatic reader cancels a job on "no".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  os: 'android',
  extra: { smsReader: true } as unknown,
  throwOnConfig: false,
  isGuest: false,
  variant: 'treatment' as string | null,
  settled: true,
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return h.os;
    },
  },
}));
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      if (h.throwOnConfig) throw new Error('no config in this host');
      return h.extra === undefined ? null : { extra: h.extra };
    },
  },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ isGuest: h.isGuest }) }));
vi.mock('@/lib/flags', () => ({
  useFlagVariant: (key: string) => (key === 'sms_inbox_read' ? h.variant : null),
  useFlagVerdict: (key: string) =>
    key === 'sms_inbox_read' ? { variant: h.variant, settled: h.settled } : null,
}));

const { SMS_INBOX_READ_FLAG, smsReaderInBuild, useSmsInboxReader, useSmsInboxReaderVerdict } =
  await import('@/lib/smsFeature');

beforeEach(() => {
  h.os = 'android';
  h.extra = { smsReader: true };
  h.throwOnConfig = false;
  h.isGuest = false;
  h.variant = 'treatment';
  h.settled = true;
});

describe('smsReaderInBuild', () => {
  it('is true only when the build config says so, literally', () => {
    expect(SMS_INBOX_READ_FLAG).toBe('sms_inbox_read');
    expect(smsReaderInBuild()).toBe(true);

    h.extra = { smsReader: 'true' };
    expect(smsReaderInBuild()).toBe(false);
    h.extra = undefined;
    expect(smsReaderInBuild()).toBe(false);
  });

  it('reads a host that throws on the config as no', () => {
    h.throwOnConfig = true;
    expect(smsReaderInBuild()).toBe(false);
  });
});

describe('useSmsInboxReader', () => {
  it('offers the reader to an Android treatment-arm account in a build that declares it', () => {
    expect(useSmsInboxReader()).toBe(true);
  });

  it('withholds it if any one gate shuts', () => {
    h.os = 'ios';
    expect(useSmsInboxReader()).toBe(false);
    h.os = 'android';

    h.extra = {};
    expect(useSmsInboxReader()).toBe(false);
    h.extra = { smsReader: true };

    h.variant = 'control';
    expect(useSmsInboxReader()).toBe(false);
    h.variant = null;
    expect(useSmsInboxReader()).toBe(false);
    h.variant = 'treatment';

    h.isGuest = true;
    expect(useSmsInboxReader()).toBe(false);
  });
});

describe('useSmsInboxReaderVerdict', () => {
  it('is on for the treatment arm once the flag table answered', () => {
    expect(useSmsInboxReaderVerdict()).toBe('on');
  });

  it('is unknown while the flag table has not answered, rather than off', () => {
    h.settled = false;
    expect(useSmsInboxReaderVerdict()).toBe('unknown');
  });

  it('is off for the control arm', () => {
    h.variant = 'control';
    expect(useSmsInboxReaderVerdict()).toBe('off');
  });

  it('is a settled off for iPhone, a build without the permission and a guest, flag or no flag', () => {
    h.settled = false;
    h.os = 'ios';
    expect(useSmsInboxReaderVerdict()).toBe('off');
    h.os = 'android';

    h.extra = {};
    expect(useSmsInboxReaderVerdict()).toBe('off');
    h.extra = { smsReader: true };

    h.isGuest = true;
    expect(useSmsInboxReaderVerdict()).toBe('off');
  });
});
