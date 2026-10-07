/**
 * Consent to send voice to third-party AI (Apple guideline 5.1.2(i)) — pure, so
 * the rules are tested apart from storage and screens.
 *
 * Advanced voice sends the mic audio to Deepgram and the transcript, with the
 * person's group and member names and balances, to an LLM. Before the first
 * such transmission the person must be told who gets what and agree; they can
 * take it back in Settings. One record per account.
 */

/**
 * Bump when the providers or the data sent change: everybody is then asked
 * again, including people who had turned it off.
 */
export const VOICE_CONSENT_VERSION = 1;

export interface VoiceConsentRecord {
  granted: boolean;
  /** Epoch ms of the choice. */
  at: number;
  version: number;
}

/**
 * - `needed`: never asked, or asked about an older set of providers.
 * - `granted`: said yes to the current providers.
 * - `revoked`: said no (turned it off in Settings) to the current providers.
 */
export type VoiceConsentState = 'needed' | 'granted' | 'revoked';

export function parseConsent(raw: string | null | undefined): VoiceConsentRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<VoiceConsentRecord> | null;
    if (
      !value ||
      typeof value.granted !== 'boolean' ||
      typeof value.at !== 'number' ||
      typeof value.version !== 'number'
    ) {
      return null;
    }
    return { granted: value.granted, at: value.at, version: value.version };
  } catch {
    return null;
  }
}

export function consentState(
  record: VoiceConsentRecord | null | undefined,
  currentVersion: number = VOICE_CONSENT_VERSION,
): VoiceConsentState {
  if (!record || record.version !== currentVersion) return 'needed';
  return record.granted ? 'granted' : 'revoked';
}

export function grantConsent(
  now: number,
  version: number = VOICE_CONSENT_VERSION,
): VoiceConsentRecord {
  return { granted: true, at: now, version };
}

export function revokeConsent(
  now: number,
  version: number = VOICE_CONSENT_VERSION,
): VoiceConsentRecord {
  return { granted: false, at: now, version };
}
