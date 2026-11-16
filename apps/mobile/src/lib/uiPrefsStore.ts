/**
 * `profiles.ui_prefs`: one JSON bag of per-person preferences synced across devices
 * (Overview layouts, the voice default space). Every writer goes through
 * `patchUiPrefs`, one at a time, so one key never overwrites another's.
 */

import { backend } from '@/lib/backend';

let chain: Promise<void> = Promise.resolve();

export async function readUiPrefs(profileId: string): Promise<Record<string, unknown>> {
  const { data, error } = await backend
    .rpc('waves_my_profile')
    .select('ui_prefs')
    .eq('id', profileId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { ui_prefs?: Record<string, unknown> } | null)?.ui_prefs ?? {};
}

/** Read-modify-write the bag. A failure leaves the phone's own copy standing; it is sent again later. */
export function patchUiPrefs(
  profileId: string,
  change: (prefs: Record<string, unknown>) => Record<string, unknown>,
): void {
  chain = chain.then(async () => {
    try {
      const next = change(await readUiPrefs(profileId));
      const { error } = await backend
        .from('profiles')
        .update({ ui_prefs: next } as never)
        .eq('id', profileId);
      if (error) throw new Error(error.message);
    } catch {
      // Offline, or no column yet.
    }
  });
}
