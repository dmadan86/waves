import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth, type Profile } from '@/lib/auth';
import { profileFromCache, toProfileCache, type CachedProfile } from '@/lib/profileCachePure';

const key = (id: string): string => `waves.profile.${id}`;

/** Called on sign-out so the next person on this phone never sees it. */
export async function clearProfileCache(userId: string): Promise<void> {
  if (userId) await AsyncStorage.removeItem(key(userId));
}

/**
 * The signed-in profile, or — only while it hasn't loaded (offline cold start) — the last one
 * this account saw on this phone. Display only (name, currency); auth state is untouched.
 */
export function useProfileForDisplay(): Profile | null {
  const { session, profile } = useAuth();
  const userId = session?.user?.id ?? null;
  const [cached, setCached] = useState<Profile | null>(null);

  useEffect(() => {
    if (!userId) return;
    if (profile && profile.id === userId) {
      void AsyncStorage.setItem(key(userId), JSON.stringify(toProfileCache(profile))).catch(
        () => undefined,
      );
      return;
    }
    let active = true;
    void AsyncStorage.getItem(key(userId))
      .then((raw) => {
        if (!active || !raw) return;
        const c = JSON.parse(raw) as CachedProfile;
        if (c.id === userId) setCached(profileFromCache(c));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [userId, profile]);

  if (profile) return profile;
  return cached && cached.id === userId ? cached : null;
}
