import { describe, expect, it } from 'vitest';

import {
  consentState,
  grantConsent,
  parseConsent,
  revokeConsent,
  VOICE_CONSENT_VERSION,
} from '@/lib/voiceConsentPure';
import { planMicStart, resolveEngine } from '@/lib/voiceEnginePure';

describe('consentState', () => {
  it('needs consent when nothing is stored', () => {
    expect(consentState(null)).toBe('needed');
    expect(consentState(undefined)).toBe('needed');
  });
  it('is granted after Allow', () => {
    expect(consentState(grantConsent(1000))).toBe('granted');
  });
  it('is revoked after switching off', () => {
    expect(consentState(revokeConsent(1000))).toBe('revoked');
  });
  it('asks again when the providers change (version bump), even after a revoke', () => {
    const granted = grantConsent(1, VOICE_CONSENT_VERSION);
    const revoked = revokeConsent(1, VOICE_CONSENT_VERSION);
    expect(consentState(granted, VOICE_CONSENT_VERSION + 1)).toBe('needed');
    expect(consentState(revoked, VOICE_CONSENT_VERSION + 1)).toBe('needed');
  });
  it('stamps time and version', () => {
    expect(grantConsent(42)).toEqual({ granted: true, at: 42, version: VOICE_CONSENT_VERSION });
  });
});

describe('parseConsent', () => {
  it('round-trips a record', () => {
    const record = grantConsent(5);
    expect(parseConsent(JSON.stringify(record))).toEqual(record);
  });
  it('reads junk as never asked', () => {
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent('')).toBeNull();
    expect(parseConsent('{nope')).toBeNull();
    expect(parseConsent('{"granted":"yes","at":1,"version":1}')).toBeNull();
    expect(parseConsent('null')).toBeNull();
  });
});

describe('engine reason for consent', () => {
  it('names "off" when cloud voice is switched off in settings', () => {
    expect(resolveEngine({ enabled: true, online: true, consent: 'revoked' })).toEqual({
      engine: 'on-device',
      reason: 'off',
    });
  });
  it('is on-device with no reason while the sheet is unanswered or declined', () => {
    expect(resolveEngine({ enabled: true, online: true, consent: 'pending' })).toEqual({
      engine: 'on-device',
      reason: null,
    });
  });
  it('is cloud once granted, and when consent is not in play', () => {
    expect(resolveEngine({ enabled: true, online: true, consent: 'granted' }).engine).toBe('cloud');
    expect(resolveEngine({ enabled: true, online: true }).engine).toBe('cloud');
  });
  it('keeps the free-plan reason ahead of consent', () => {
    expect(resolveEngine({ enabled: false, online: true, consent: 'revoked' }).reason).toBe('free');
  });
  it('never starts a stream without consent', () => {
    const base = { enabled: true, online: true, held: false };
    expect(planMicStart({ ...base, consent: 'revoked' })).toMatchObject({
      stream: false,
      fallback: { engine: 'on-device', reason: 'off' },
    });
    expect(planMicStart({ ...base, consent: 'pending' }).stream).toBe(false);
    expect(planMicStart({ ...base, consent: 'granted' }).stream).toBe(true);
  });
});
