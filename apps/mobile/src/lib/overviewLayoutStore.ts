/**
 * Remembers a person's Overview layout per account and company. The phone keeps it first (instant, works
 * offline); the same JSON is mirrored into `profiles.ui_prefs` so a second device picks it up. The newest
 * `at` wins. A server without that column (migration not yet applied) just leaves the layout on the phone.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { patchUiPrefs, readUiPrefs } from '@/lib/uiPrefsStore';
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

const key = (profileId: string, groupId: string): string =>
  `waves.overview_layout:${profileId}:${groupId}`;

const parse = (raw: unknown): Saved | null => {
  const o = raw as Partial<Saved> | null;
  return o && typeof o === 'object' && typeof o.at === 'number' ? (o as Saved) : null;
};

async function readRemote(profileId: string): Promise<Record<string, unknown>> {
  return ((await readUiPrefs(profileId)).overviewLayouts ?? {}) as Record<string, unknown>;
}

function pushRemote(profileId: string, groupId: string, saved: Saved): void {
  patchUiPrefs(profileId, (prefs) => ({
    ...prefs,
    overviewLayouts: {
      ...((prefs.overviewLayouts ?? {}) as Record<string, unknown>),
      [groupId]: saved,
    },
  }));
}

export function useOverviewLayout(
  groupId: string,
  role: OverviewRole,
): { layout: OverviewLayout; save: (next: OverviewLayout) => void; reset: () => void } {
  const profileId = useAuth().profile?.id ?? null;
  const id = `${profileId}:${groupId}:${role}`;
  // Keyed, so a new account, company or role never shows the previous one's layout.
  const [state, setState] = useState<{ id: string; layout: OverviewLayout } | null>(null);
  const layout = state?.id === id ? state.layout : defaultLayout(role);
  const setLayout = useCallback((l: OverviewLayout) => setState({ id, layout: l }), [id]);
  const at = useRef(0);
  const edited = useRef(false);

  useEffect(() => {
    // A new account, company or role starts from its own layout, not the previous one's.
    at.current = 0;
    edited.current = false;
    if (!profileId) return;
    let live = true;
    const apply = (s: Saved | null): boolean => {
      if (!live || edited.current || !s || s.at <= at.current) return false;
      at.current = s.at;
      setLayout(resolveLayout(role, s));
      return true;
    };
    void (async () => {
      let local: Saved | null = null;
      try {
        local = parse(JSON.parse((await AsyncStorage.getItem(key(profileId, groupId))) ?? 'null'));
        apply(local);
      } catch {
        // A bad local value is the default layout.
      }
      try {
        const remote = parse((await readRemote(profileId))[groupId]);
        if (apply(remote) && remote)
          void AsyncStorage.setItem(key(profileId, groupId), JSON.stringify(remote)).catch(
            () => undefined,
          );
        // This phone has the newer one (changed offline): send it up.
        else if (live && !edited.current && local && (!remote || local.at > remote.at))
          pushRemote(profileId, groupId, local);
      } catch {
        // Offline or no column yet: the phone's copy stands.
      }
    })();
    return () => {
      live = false;
    };
  }, [profileId, groupId, role, setLayout]);

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
      pushRemote(profileId, groupId, saved);
    },
    [profileId, groupId, setLayout],
  );

  const reset = useCallback((): void => save(defaultLayout(role)), [save, role]);
  return { layout, save, reset };
}
