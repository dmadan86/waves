import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';

import { activeStrings } from '@/i18n';
import { ensurePermission } from '@/lib/permissionFlow';

interface NativeBackup {
  start(labels: Record<string, string>): Promise<void>;
  update(status: string, percent: number): void;
  stop(status: string): void;
  addListener(event: string, callback: () => void): { remove(): void };
}
export const native =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeBackup>('WavesBackup') : null;

export async function requestBackupNotification() {
  if (Number(Platform.Version) >= 33) {
    const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    const state = async () => ({
      granted: await PermissionsAndroid.check(perm),
      canAskAgain: true,
    });
    await ensurePermission('notifications', {
      check: state,
      request: async () => {
        await PermissionsAndroid.request(perm);
        return state();
      },
    });
  }
}

export function notificationLabels(): Record<string, string> {
  const t = activeStrings();
  return {
    preparing: t.backup.notificationPreparing,
    preparingBody: t.backup.notificationPreparingBody,
    uploading: t.backup.notificationUploading,
    uploadingBody: t.backup.notificationUploadingBody,
    complete: t.backup.notificationComplete,
    completeBody: t.backup.notificationCompleteBody,
    failed: t.backup.notificationFailed,
    failedBody: t.backup.notificationFailedBody,
    paused: t.backup.notificationPaused,
    pausedBody: t.backup.notificationPausedBody,
    cancelled: t.backup.notificationCancelled,
    cancelledBody: t.backup.interruptedHint,
    cancel: t.common.cancel,
  };
}
