/**
 * "Dollar ($) means": which dollar a bare "$", "dollars" or "bucks" is, so voice
 * and typed text stop asking "US or Australian dollars?" every time. Kept on the
 * phone first and mirrored into `profiles.ui_prefs.dollarMeans` so a second
 * device follows; the newest `at` wins (same shape as the voice default space).
 * Never chosen: the person's own currency if it is a dollar, else USD.
 */

import { useCallback, useEffect } from 'react';

import { effectiveDollarMeans, setDollarMeans, type DollarMeans } from '@waves/core';

import { useViewerId } from '@/lib/auth';
import { useDefaultCurrency } from '@/lib/currency';
import { patchUiPrefs, readUiPrefs } from '@/lib/uiPrefsStore';
import { profileStore } from '@/lib/voiceSpaceStore';

interface Saved {
  means: string | null;
  at: number;
}

const store = profileStore<Saved>('waves.dollar_means', { means: null, at: 0 });

export function useDollarMeans(): { means: DollarMeans; setMeans: (next: DollarMeans) => void } {
  const [saved, setSaved] = store.use();
  const profileId = useViewerId();
  const defaultCurrency = useDefaultCurrency();
  const means = effectiveDollarMeans(saved.means, defaultCurrency);

  // Every parser reads the one effective value.
  useEffect(() => setDollarMeans(means), [means]);

  useEffect(() => {
    if (!profileId) return;
    let live = true;
    void readUiPrefs(profileId)
      .then((prefs) => {
        const remote = prefs.dollarMeans as Partial<Saved> | undefined;
        if (live && remote && typeof remote.at === 'number' && remote.at > saved.at)
          setSaved({
            means: typeof remote.means === 'string' ? remote.means : null,
            at: remote.at,
          });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Once per sign-in: later local edits are pushed by `setMeans`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const setMeans = useCallback(
    (next: DollarMeans): void => {
      const value = { means: next, at: Date.now() };
      setSaved(value);
      if (profileId) patchUiPrefs(profileId, (prefs) => ({ ...prefs, dollarMeans: value }));
    },
    [profileId, setSaved],
  );
  return { means, setMeans };
}

/** Mounted once at the root so the parsers know the setting before any screen asks. */
export function DollarMeansApply(): null {
  useDollarMeans();
  return null;
}
