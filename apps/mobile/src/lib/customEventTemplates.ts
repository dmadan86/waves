/**
 * Names a person gave their own event template ("Housewarming") when they chose
 * "Other" while creating an Event group. Remembered on this device, per
 * account, and offered back as quick chips next time — most recent first.
 *
 * The name itself is stored on the group in its existing `custom_tag` column
 * (the tag every list and the group header already show in place of the kind
 * word), so no schema change is needed. This module is the pure list logic
 * plus a thin AsyncStorage wrapper.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { normaliseGroupTag } from '@/lib/groupTypeTag';

/** How many remembered names are kept and offered. */
export const CUSTOM_TEMPLATES_MAX = 6;

const same = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/**
 * `name` goes to the front of `list`: normalised, deduped (case-insensitive,
 * the newer spelling wins), capped at CUSTOM_TEMPLATES_MAX. A blank name, or one
 * equal to a built-in label in `builtIns`, leaves the list as it was.
 */
export function addCustomTemplate(
  list: readonly string[],
  name: string,
  builtIns: readonly string[] = [],
): string[] {
  const clean = normaliseGroupTag(name);
  if (!clean || builtIns.some((b) => same(b, clean))) return [...list];
  return [clean, ...list.filter((x) => !same(x, clean))].slice(0, CUSTOM_TEMPLATES_MAX);
}

export function removeCustomTemplate(list: readonly string[], name: string): string[] {
  return list.filter((x) => !same(x, name));
}

const keyFor = (accountId: string): string => `eventTemplates.custom.${accountId}`;

export async function loadCustomTemplates(accountId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(accountId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === 'string')
      .reduce<string[]>((acc, x) => (acc.some((y) => same(y, x)) ? acc : [...acc, x]), [])
      .slice(0, CUSTOM_TEMPLATES_MAX);
  } catch {
    return [];
  }
}

export async function saveCustomTemplates(
  accountId: string,
  list: readonly string[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(accountId), JSON.stringify(list));
  } catch {
    // A lost preference, never lost data.
  }
}
