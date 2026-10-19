import { describe, expect, it } from 'vitest';

import {
  buildPayload,
  EVENT_NAMES,
  isEventName,
  isInstallId,
  normalizePlatform,
  normalizeVersion,
  sanitizeProps,
} from '../src/lib/eventsCore';

const ID = '3f2b8c1e-5d4a-4e7b-9c6a-1b2c3d4e5f60';

describe('event names', () => {
  it('are the four the database cannot derive, then the ten assistant steps', () => {
    expect([...EVENT_NAMES]).toEqual([
      'app_installed',
      'signup_started',
      'onboarding_completed',
      'premium_viewed',
      'assistant_opened',
      'assistant_command',
      'assistant_followup_shown',
      'assistant_followup_answered',
      'assistant_followup_skipped',
      'assistant_followup_muted',
      'assistant_correction',
      'assistant_undo',
      'assistant_question_answered',
      'assistant_teaser_viewed',
    ]);
  });

  it('refuses anything else', () => {
    expect(isEventName('expense_added')).toBe(false);
    expect(isEventName('')).toBe(false);
    expect(isEventName(undefined)).toBe(false);
    expect(isEventName('premium_viewed')).toBe(true);
  });
});

describe('sanitizeProps', () => {
  it('keeps small enum words under known keys', () => {
    expect(sanitizeProps({ method: 'phone' })).toEqual({ method: 'phone' });
    expect(sanitizeProps({ screen: 'paywall', source: 'settings' })).toEqual({
      screen: 'paywall',
      source: 'settings',
    });
  });

  it('keeps the Plus price arm under variant, and only as a short lowercase word', () => {
    expect(sanitizeProps({ screen: 'paywall', variant: 'p79' })).toEqual({
      screen: 'paywall',
      variant: 'p79',
    });
    expect(sanitizeProps({ variant: 'P 79' })).toEqual({});
    expect(sanitizeProps({ variant: 79 })).toEqual({});
  });

  it('drops keys that are not on the list', () => {
    expect(sanitizeProps({ method: 'phone', phone: '+919999999999', email: 'a@b.co' })).toEqual({
      method: 'phone',
    });
    expect(sanitizeProps({ amount: 4200, description: 'Dinner', name: 'Asha' })).toEqual({});
  });

  it('drops values that are not short lowercase words', () => {
    expect(sanitizeProps({ method: '+919999999999' })).toEqual({});
    expect(sanitizeProps({ method: 'a@b.co' })).toEqual({});
    expect(sanitizeProps({ source: 'Dinner at Taj' })).toEqual({});
    expect(sanitizeProps({ source: 'x'.repeat(41) })).toEqual({});
    expect(sanitizeProps({ method: 'x'.repeat(33) })).toEqual({});
    expect(sanitizeProps({ screen: '' })).toEqual({});
  });

  it('keeps campaign tags up to 40 characters, and no more', () => {
    expect(sanitizeProps({ source: 'meta', medium: 'paid', campaign: 'diwali_in-2026' })).toEqual({
      source: 'meta',
      medium: 'paid',
      campaign: 'diwali_in-2026',
    });
    expect(sanitizeProps({ campaign: 'x'.repeat(40) })).toEqual({ campaign: 'x'.repeat(40) });
    expect(sanitizeProps({ campaign: 'x'.repeat(41) })).toEqual({});
    expect(sanitizeProps({ medium: 'Paid Social' })).toEqual({});
    expect(sanitizeProps({ campaign: 'a@b.co' })).toEqual({});
  });

  it('drops values that are not strings', () => {
    expect(sanitizeProps({ method: 42, source: true, screen: { a: 1 } })).toEqual({});
    expect(sanitizeProps({ method: null })).toEqual({});
  });

  it('survives garbage without throwing', () => {
    for (const bad of [null, undefined, 'phone', 7, ['method'], () => 1]) {
      expect(sanitizeProps(bad)).toEqual({});
    }
  });
});

describe('platform and version', () => {
  it('keeps the three platforms and nothing else', () => {
    expect(normalizePlatform('ios')).toBe('ios');
    expect(normalizePlatform('android')).toBe('android');
    expect(normalizePlatform('web')).toBe('web');
    expect(normalizePlatform('windows')).toBeNull();
  });

  it('keeps ordinary version strings', () => {
    expect(normalizeVersion('1.2.6')).toBe('1.2.6');
    expect(normalizeVersion('1.2.6-beta.1+14')).toBe('1.2.6-beta.1+14');
    expect(normalizeVersion('not a version')).toBeNull();
    expect(normalizeVersion(null)).toBeNull();
    expect(normalizeVersion(12)).toBeNull();
  });
});

describe('install id', () => {
  it('is a uuid', () => {
    expect(isInstallId(ID)).toBe(true);
    expect(isInstallId('abc')).toBe(false);
    expect(isInstallId(null)).toBe(false);
  });
});

describe('buildPayload', () => {
  it('builds the RPC arguments, sanitising the props', () => {
    expect(
      buildPayload({
        installId: ID,
        name: 'signup_started',
        props: { method: 'phone', phone: '+911234567890' },
        platform: 'android',
        version: '1.2.6',
      }),
    ).toEqual({
      p_install_id: ID,
      p_name: 'signup_started',
      p_platform: 'android',
      p_app_version: '1.2.6',
      p_props: { method: 'phone' },
    });
  });

  it('sends empty props when none are given', () => {
    expect(
      buildPayload({ installId: ID, name: 'app_installed', platform: 'ios', version: null })
        ?.p_props,
    ).toEqual({});
  });

  it('returns null for an unknown event or a malformed install id', () => {
    expect(
      buildPayload({ installId: ID, name: 'expense_added', platform: 'ios', version: '1.0.0' }),
    ).toBeNull();
    expect(
      buildPayload({ installId: 'nope', name: 'app_installed', platform: 'ios', version: '1.0.0' }),
    ).toBeNull();
  });
});
