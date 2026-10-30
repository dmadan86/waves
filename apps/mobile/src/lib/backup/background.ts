import AsyncStorage from '@react-native-async-storage/async-storage';
import { native, requestBackupNotification, notificationLabels } from '@/lib/backup/native';
import { active, transition, shouldNotify, type RunProgress } from './progress';
let state: RunProgress = { status: 'complete', percent: null };
const listeners = new Set<() => void>();
let cancel: (() => void) | undefined;
let notified = state;
let notifiedAt = 0;
export const backupSnapshot = () => state;
export function subscribeBackup(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function cancelBackup() {
  cancel?.();
}
export function publishBackup(next: RunProgress) {
  state = transition(state, next);
  next = state;
  listeners.forEach((listener) => listener());
  if (shouldNotify(notified, next, Date.now() - notifiedAt)) {
    native?.update(next.status, next.percent ?? -1);
    notified = next;
    notifiedAt = Date.now();
  }
}
export async function beginBackground(
  ownerId: string,
  abort: (reason?: 'timeout') => void,
  manual: boolean,
) {
  cancel = abort;
  await AsyncStorage.setItem(`waves.backup.interrupted.${ownerId}`, '1');
  publishBackup({ status: 'preparing', percent: null });
  if (manual && native) {
    if (!(await AsyncStorage.getItem('waves.backup.notificationAsked'))) {
      await AsyncStorage.setItem('waves.backup.notificationAsked', '1');
      await requestBackupNotification();
    }
    await native.start(notificationLabels()).catch((error: unknown) => {
      // Builds before 19 return the service's ComponentName, which the bridge
      // rejects after the service has already started: carry on.
      if (!/ComponentName/.test(String((error as Error)?.message ?? error))) throw error;
    });
  }
  const subscription = native?.addListener('cancel', () => abort());
  const timeout = native?.addListener('timeout', () => abort('timeout'));
  return () => {
    subscription?.remove();
    timeout?.remove();
  };
}
export async function finishBackground(ownerId: string, status: RunProgress['status']) {
  cancel = undefined;
  publishBackup({ status, percent: status === 'complete' ? 100 : null });
  native?.stop(status);
  await AsyncStorage.removeItem(`waves.backup.interrupted.${ownerId}`);
}
export async function recoverBackground(ownerId: string) {
  if (!active(state) && (await AsyncStorage.getItem(`waves.backup.interrupted.${ownerId}`))) {
    publishBackup({ status: 'failed', percent: null });
  }
}
