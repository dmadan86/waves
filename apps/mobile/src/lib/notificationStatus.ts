import type { PushPermission } from '@/lib/push';

/**
 * The Settings row's status for Notifications, from the phone's permission.
 * `null` until it has been read, so the row shows nothing rather than a guess.
 * Type-only import of the enum: the values are compared as their string forms
 * so this stays free of the native notifications module.
 */
export function notificationsRowStatus(
  permission: PushPermission | null,
  strings: { rowOn: string; rowOff: string; rowOffInPhone: string },
): string | undefined {
  if (permission === null) return undefined;
  const value = permission as string;
  if (value === 'granted') return strings.rowOn;
  if (value === 'denied') return strings.rowOffInPhone;
  return strings.rowOff;
}
