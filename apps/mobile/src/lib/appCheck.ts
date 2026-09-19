/**
 * App Check — the thing that makes a Firebase request provably come from *this*
 * app, on a real device, rather than from anybody who read the API key out of
 * the APK.
 *
 * The key is not a secret and never was: `google-services.json` ships inside
 * every install, and `AIza…` is readable with `unzip` and `grep`. What stops a
 * stranger driving our Firebase project with it is supposed to be App Check —
 * Play Integrity on Android, App Attest on iOS — which asks Google to vouch for
 * the binary before the request is honoured.
 *
 * Until now nothing did. That was survivable while phone sign-in was off,
 * because an unused project costs nothing to abuse. It stops being survivable
 * the moment Blaze is on: phone auth is billed per SMS, so an unattested
 * endpoint is a stranger's ability to spend money — send a code to any number
 * in the world, as many times as the quotas allow, on our card. `waves_phone_gate`
 * caps three codes per *number* per day, which is real and stays; it does
 * nothing about somebody walking a million different numbers.
 *
 * ## Initialising it is not enforcing it
 *
 * This file only makes the app *send* an attestation token. Whether Firebase
 * *requires* one is a switch in the console, and the order matters: turn
 * enforcement on while installs in the wild cannot attest, and phone sign-in
 * breaks for every one of them at once, with nothing shippable to fix it
 * because the fix is a new binary. The sequence is ship this, watch the App
 * Check metrics until the verified share stops climbing, then enforce. See the
 * PR for where that dashboard is.
 *
 * ## Debug builds
 *
 * `__DEV__` selects the debug provider, which is the only one that can work off
 * a real store install: Play Integrity wants a binary Google signed, and a
 * debug APK is not one. The debug provider prints a token on first run that has
 * to be registered in the console before it is trusted, so a fresh dev machine
 * gets unverified requests until somebody does that — which is fine while
 * enforcement is off, and is the reason to leave it off until it isn't.
 */

import { loadFirebaseAppCheck } from '@/lib/firebaseModule';

/**
 * The attempt, not the answer.
 *
 * Held as the promise rather than a boolean so that two callers arriving at
 * once — which is ordinary, the phone screen mounts and the person taps quickly
 * — await one initialisation instead of racing two. Firebase tolerates a second
 * `initializeAppCheck`, but the second is work nobody needs and the shared
 * promise costs a line.
 */
let attempt: Promise<boolean> | null = null;

/**
 * Turn App Check on, once, and say whether it is on.
 *
 * Never throws and never rejects. Every caller is a step on somebody's way into
 * the app, and none of them has anything useful to do with a failure here:
 * refusing a sign-in because attestation could not start would be choosing to
 * break the thing App Check exists to protect. So a failure is logged, answered
 * `false`, and the request goes on to be judged on its merits — which, while
 * enforcement is off, is exactly what would have happened anyway.
 */
export function ensureAppCheck(): Promise<boolean> {
  attempt ??= start();
  return attempt;
}

async function start(): Promise<boolean> {
  try {
    // Inside the `try`, not above it. The loader is written not to throw, but
    // "never rejects" has to hold even when the loader itself is not what this
    // file expects — a partially-mocked module, a package whose shape changed
    // under a major bump. The guarantee is only worth having if it survives
    // the case nobody predicted.
    const firebase = loadFirebaseAppCheck?.();
    // A build without the module. Not an error and not worth a log line: it is
    // the expected state of every binary made before this change, and those are
    // precisely the ones that must not be disturbed.
    if (!firebase) return false;

    await firebase.initializeAppCheck(firebase.getApp(), {
      provider: {
        providerOptions: {
          android: { provider: __DEV__ ? 'debug' : 'playIntegrity' },
          apple: { provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback' },
        },
      },
      // Let the SDK keep the token fresh. The alternative is a token that
      // expires mid-session and a sign-in that fails for a reason nobody can
      // see, at the one moment somebody is trying to get in.
      isTokenAutoRefreshEnabled: true,
    });
    return true;
  } catch (error) {
    // Worth saying out loud, because the symptom once enforcement is on is a
    // sign-in that simply stops working, and this line is the difference
    // between that and a mystery.
    console.warn('App Check could not start:', error);
    return false;
  }
}

/** Test seam: a cold start is the default, and tests need it back. */
export function forgetAppCheck(): void {
  attempt = null;
}
