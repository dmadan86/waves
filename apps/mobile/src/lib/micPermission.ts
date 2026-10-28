import { Linking } from 'react-native';

import { ensurePermission, type PermissionState } from '@/lib/permissionFlow';

interface PermissionSource {
  getPermissionsAsync(): Promise<PermissionState>;
  requestPermissionsAsync(): Promise<PermissionState>;
}

/** Microphone + speech permission through the shared explainer-then-native flow. */
export function ensureMicPermission(speech: PermissionSource): Promise<PermissionState> {
  return ensurePermission('mic', {
    check: () => speech.getPermissionsAsync().catch(() => ({ granted: false, canAskAgain: true })),
    request: () => speech.requestPermissionsAsync(),
    openSettings: () => Linking.openSettings(),
  });
}
