/**
 * Remembers a person's Overview layout per account and company. The phone keeps it first (instant, works
 * offline); the same JSON is mirrored into `profiles.ui_prefs` so a second device picks it up. The newest
 * `at` wins. A server without that column (migration not yet applied) just leaves the layout on the phone.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { backend } from '@/lib/backend';
import { useAuth } from '@/lib/auth';
import {
  defaultLayout,
  resolveLayout,
  type OverviewLayout,
  type OverviewRole,
} from '@/lib/overviewLayout';

interface Saved extends OverviewLayout {
  at: number;
}

let chain: Promise<void> = Promise.resolve();

const key = (profileId: string, groupId: string): string =>
  `waves.overview_layout:${profileId}:${groupId}`;

const parse = (raw: unknown): Saved | null => {
  const o = raw as Partial<Saved> | null;
  return o && typeof o === 'object' && typeof o.at === 'number' ? (o as Saved) : null;
};

async function readRemote(profileId: string): Promise<Record<string, unknown>> {
  const { data, error } = await backend
    .rpc('waves_my_profile')
    .select('ui_prefs')
    .eq('id', profileId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const prefs = (data as { ui_prefs?: { overviewLayouts?: Record<string, unknown> } } | null)
    ?.ui_prefs;
  return prefs?.overviewLayouts ?? {};
}

export function useOverviewLayout(
  groupId: string,
  role: OverviewRole,
): { layout: OverviewLayout; save: (next: OverviewLayout) => void; reset: () => void } {
  const profileId = useAuth().profile?.id ?? null;
  const [layout, setLayout] = useState<OverviewLayout>(() => defaultLayout(role));
  const at = useRef(0);
  const edited = useRef(false);

  useEffect(() => {
    if (!profileId) return;
    let live = true;
    const apply = (s: Saved | null): void => {
      if (!live || edited.current || !s || s.at <= at.current) return;
      at.current = s.at;
      setLayout(resolveLayout(role, s));
    };
    void (async () => {
      try {
        apply(parse(JSON.parse((await AsyncStorage.getItem(key(profileId, groupId))) ?? 'null')));
      } catch {
        // A bad local value is the default layout.
      }
      try {
        const remote = parse((await readRemote(profileId))[groupId]);
        apply(remote);
        if (remote && live && remote.at > 0)
          void AsyncStorage.setItem(key(profileId, groupId), JSON.stringify(remote)).catch(
            () => undefined,
          );
      } catch {
        // Offline or no column yet: the phone's copy stands.
      }
    })();
    return () => {
      live = false;
    };
  }, [profileId, groupId, role]);

  const save = useCallback(
    (next: OverviewLayout): void => {
      edited.current = true;
      setLayout(next);
      if (!profileId) return;
      const saved: Saved = { ...next, at: Date.now() };
      at.current = saved.at;
      void AsyncStorage.setItem(key(profileId, groupId), JSON.stringify(saved)).catch(
        () => undefined,
      );
      // One write at a time, so a slow earlier save cannot land after a newer one.
      chain = chain.then(async () => {
        try {
          const all = await readRemote(profileId);
          const { error } = await backend
            .from('profiles')
            .update({ ui_prefs: { overviewLayouts: { ...all, [groupId]: saved } } } as never)
            .eq('id', profileId);
          if (error) throw new Error(error.message);
        } catch {
          // Stays on this phone; the next change tries again.
        }
      });
    },
    [profileId, groupId],
  );

  const reset = useCallback((): void => save(defaultLayout(role)), [save, role]);
  return { layout, save, reset };
}
