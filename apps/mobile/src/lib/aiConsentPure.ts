/** One-time consent before "Ask" sends entries to the AI provider; kept per account on this device. */

export const aiConsentKey = (viewerId: string): string => `waves.ai_ask_consent:${viewerId}`;

export const AI_CONSENT_GRANTED = 'granted';

/** Only an explicit stored "granted" counts; anything else asks again. */
export const isAiConsentGranted = (stored: string | null | undefined): boolean =>
  stored === AI_CONSENT_GRANTED;
