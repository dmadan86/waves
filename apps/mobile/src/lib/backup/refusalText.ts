import type { BackupRefusal } from './engine';

export function backupRefusalText(
  refusal: BackupRefusal,
  text: { e2eeLoading: string },
): string | null {
  return refusal === 'e2ee-loading' ? text.e2eeLoading : null;
}
