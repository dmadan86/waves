import AsyncStorage from '@react-native-async-storage/async-storage';

import type { UiStrings } from '@/i18n';
import { aiConsentKey, AI_CONSENT_GRANTED, isAiConsentGranted } from '@/lib/aiConsentPure';
import type { ConfirmOptions } from '@/lib/dialog';

/**
 * True when this account has allowed sending entries to the AI provider, asking
 * once if it has not. A "Not now" is not remembered, so it is asked next time.
 */
export async function ensureAiConsent(
  viewerId: string | null,
  confirm: (options: ConfirmOptions) => Promise<boolean>,
  t: UiStrings,
): Promise<boolean> {
  if (!viewerId) return false;
  try {
    if (isAiConsentGranted(await AsyncStorage.getItem(aiConsentKey(viewerId)))) return true;
  } catch {
    // Unreadable storage reads as "not asked yet": the safe side.
  }
  const yes = await confirm({
    title: t.spacePrivacy.aiConsentTitle,
    body: t.spacePrivacy.aiConsentBody,
    confirmLabel: t.spacePrivacy.aiConsentAllow,
    cancelLabel: t.spacePrivacy.aiConsentNotNow,
  });
  if (yes) await AsyncStorage.setItem(aiConsentKey(viewerId), AI_CONSENT_GRANTED).catch(() => {});
  return yes;
}
