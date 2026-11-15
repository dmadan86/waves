import { describe, expect, it } from 'vitest';

import { needsTwoStep, safeNext, type TwoStepStatus } from '@/lib/twoStep';

const status = (over: Partial<TwoStepStatus> = {}): TwoStepStatus => ({
  sessionVerified: false,
  hasPhone: true,
  hasAuthenticator: false,
  pendingDevice: false,
  requiring: [{ groupId: 'g1', name: 'Acme' }],
  ...over,
});

describe('safeNext', () => {
  it('keeps same-origin relative paths', () => {
    expect(safeNext('/c/g1/team?x=1')).toBe('/c/g1/team?x=1');
  });
  it.each([null, undefined, '', 'https://evil.com', '//evil.com', '/\\evil.com', 'c/g1', '/a\nb'])(
    'rejects %j',
    (value) => expect(safeNext(value)).toBe('/'),
  );
});

describe('needsTwoStep', () => {
  it('redirects a requiring company route and keeps next', () => {
    expect(needsTwoStep('/c/g1/team', status())).toBe('/auth/two-step?next=%2Fc%2Fg1%2Fteam');
    expect(needsTwoStep('/c/g1', status())).toBe('/auth/two-step?next=%2Fc%2Fg1');
  });
  it('leaves other companies, personal pages and verified sessions alone', () => {
    expect(needsTwoStep('/c/g2/team', status())).toBeNull();
    expect(needsTwoStep('/settings', status())).toBeNull();
    expect(needsTwoStep('/groups', status())).toBeNull();
    expect(needsTwoStep('/c/g1/team', status({ sessionVerified: true }))).toBeNull();
    expect(needsTwoStep('/c/g1/team', null)).toBeNull();
  });
});
