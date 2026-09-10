/**
 * The invite-QR scanner, kept behind a runtime check.
 *
 * `expo-camera` is a native module. On a JS-only reload of an older dev-client
 * — one built before the module was installed — importing its `CameraView`
 * eagerly would reach for a native view that is not there. So nothing here
 * imports `expo-camera`; callers ask `cameraAvailable()` first and only mount
 * the camera leaf when the answer is yes, showing a "rebuild the app" notice
 * otherwise. Same discipline the document scanner uses (see `scanner.ts`).
 */

import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/** Whether this binary actually contains the camera module. False on web, and
 *  on any dev-client built before `expo-camera` was added. */
export function cameraAvailable(): boolean {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  return requireOptionalNativeModule('ExpoCamera') != null;
}

/**
 * Re-exported, not redefined. The parser moved to `lib/inviteLink` so
 * `app/+native-intent.ts` can read an incoming App Link without importing this
 * file's native camera check; every existing caller keeps importing it from
 * here.
 */
export { tokenFromScan } from '@/lib/inviteLink';
