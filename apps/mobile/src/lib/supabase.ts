import 'react-native-url-polyfill/auto';

import { createClient, type Session } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { secureAuthStorage } from './secureStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Whether this build actually shipped its Supabase keys.
 *
 * A build with the wrong or empty `EXPO_PUBLIC_*` env — a misconfigured EAS
 * profile — used to `throw` right here, at module load. This module is imported
 * by the root layout, *above* every error boundary, so that threw before React
 * mounted and the app died on the first frame with no recoverable screen for
 * 100% of users. Now the miss is a flag the root reads (see `_layout`) to paint
 * a plain "this build is misconfigured" screen instead of crashing. The client
 * is still constructed below — with an unreachable placeholder so `createClient`
 * cannot throw on import — and the root never lets it be *used* when this is
 * false, so no request is ever made to the placeholder.
 */
export const supabaseConfigured = Boolean(url && anonKey);
if (!supabaseConfigured) {
  console.error(
    'Waves is misconfigured: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set in this build.',
  );
}

/**
 * The anon key is safe to ship: every table is behind RLS (ADR-013), so this
 * client can only ever see rows the signed-in user is entitled to. Service
 * credentials live in edge functions and never in the bundle.
 */
// Expo Router pre-renders web routes in Node, where there is no storage and no
// window; the client must construct there without touching either.
const isServer = typeof window === 'undefined';

export const supabase = createClient(
  // A well-formed, never-contacted placeholder when the build is unconfigured:
  // it only exists so `createClient` constructs without throwing on import (the
  // root gates on `supabaseConfigured`, so no request is ever made to it). Shaped
  // like a real project URL so even a stricter future URL validation accepts it.
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-anon-key',
  {
    auth: {
      // Native keeps the session (incl. the long-lived refresh token) in the OS
      // keystore, not plaintext AsyncStorage; web falls back inside the adapter.
      storage: isServer ? undefined : secureAuthStorage,
      autoRefreshToken: !isServer,
      persistSession: !isServer,
      // No URL-based session handoff on native; deep links are handled explicitly.
      detectSessionInUrl: !isServer && Platform.OS === 'web',
      // PKCE: the provider redirect carries a one-time code, not the session.
      // The verifier that redeems it lives in this client's storage, so another
      // app on the device that claims `waves://` and catches the redirect holds
      // nothing it can use. The implicit default put the refresh token itself in
      // the URL fragment. The exchange happens in `lib/auth.tsx`.
      flowType: 'pkce',
    },
  },
);

// Refresh tokens only while the app is in front of the user. Skipped entirely
// on a misconfigured build so the placeholder client is never poked.
if (!isServer && supabaseConfigured) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}

/**
 * The session this phone saved last time, read straight from the keystore
 * without going to the network.
 *
 * `getSession` refreshes an expired access token before it resolves, and the
 * access token lives an hour — so every launch after a phone has sat for a
 * while waited on a network round trip before the app could decide it was
 * signed in. On a slow connection that was seconds of spinner in front of a
 * dashboard whose data was already on the device.
 *
 * Who is signed in is enough to open the app: every network call goes through
 * the client, which refreshes the token itself before it sends anything. So
 * this answers the gate at once, and `getSession` still lands afterwards and
 * has the final word — a refresh token the server refused signs them out then.
 *
 * Null for anything it does not recognise as a whole session. Never throws.
 */
export async function peekStoredSession(): Promise<Session | null> {
  if (isServer || !supabaseConfigured) return null;
  try {
    // The client's own key (`sb-<project>-auth-token`); read it rather than
    // re-derive it, so a custom `storageKey` later cannot drift from this.
    const key = (supabase.auth as unknown as { storageKey?: unknown }).storageKey;
    if (typeof key !== 'string') return null;
    const raw = await secureAuthStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { currentSession?: unknown } | null;
    // Older clients wrapped the session as `{ currentSession, expiresAt }`.
    const candidate = (parsed?.currentSession ?? parsed) as Partial<Session> | null;
    if (
      !candidate ||
      typeof candidate.access_token !== 'string' ||
      typeof candidate.refresh_token !== 'string' ||
      typeof candidate.user?.id !== 'string'
    ) {
      return null;
    }
    return candidate as Session;
  } catch {
    return null;
  }
}
