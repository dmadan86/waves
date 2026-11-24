import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UiStrings } from '@/i18n';
import type { ConfirmOptions } from '@/lib/dialog';
import { lockOfferKey, shouldOfferLock } from '@/lib/lockOfferPure';

/** Ask once per account; "shown" is stored before asking so a crash never repeats it. */
export async function offerLockOnce(input: {
  userId: string | null;
  groupType: string;
  lockEnabled: boolean;
  lockSupported: boolean;
  setEnabled: (value: boolean) => Promise<void>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  t: UiStrings;
}): Promise<void> {
  const { userId, t } = input;
  if (!userId) return;
  try {
    const alreadyShown = (await AsyncStorage.getItem(lockOfferKey(userId))) !== null;
    if (!shouldOfferLock({ ...input, alreadyShown })) return;
    await AsyncStorage.setItem(lockOfferKey(userId), '1');
  } catch {
    return;
  }
  const yes = await input.confirm({
    title: t.spacePrivacy.lockOfferTitle,
    body: t.spacePrivacy.lockOfferBody,
    confirmLabel: t.spacePrivacy.lockOfferYes,
    cancelLabel: t.spacePrivacy.lockOfferNo,
  });
  if (yes) await input.setEnabled(true);
}
