/**
 * The one place `@react-native-firebase/auth` and `/app-check` are named.
 *
 * It is a **native module**, so importing it at the top of a file means an app
 * whose JavaScript was updated over the air, on a binary built before Firebase
 * was added, dies at *launch* — not on the phone screen, at launch, with nothing
 * local to catch it. So the require is lazy and wrapped in a check that cannot
 * throw, which is this repo's standing rule for anything native.
 *
 * It lives alone in a file for a second reason: a `require` cannot be
 * substituted by a test the way an import can, so the seam that lets the phone
 * flow be tested at all is exactly here — the module boundary. Everything above
 * it is ordinary JavaScript.
 */

/** What Firebase hands back between sending a code and checking it. */
export interface PhoneConfirmation {
  confirm(code: string): Promise<{ user: { getIdToken(): Promise<string> } } | null>;
}

export interface FirebaseAuth {
  (): {
    signInWithPhoneNumber(phone: string): Promise<PhoneConfirmation>;
    signOut(): Promise<void>;
  };
}

/** The module, or null on a build that has no Firebase in it. Never throws. */
export function loadFirebaseAuth(): FirebaseAuth | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('@react-native-firebase/auth') as { default?: FirebaseAuth };
    return loaded.default ?? null;
  } catch {
    return null;
  }
}

/**
 * What App Check needs from the two modules that set it up.
 *
 * Typed structurally rather than imported, for the same reason as everything
 * above: naming the package in a type position is still naming the package, and
 * a build without it must not so much as reach for the name.
 */
export interface FirebaseAppCheck {
  getApp: () => unknown;
  initializeAppCheck: (
    app: unknown,
    options: {
      provider: {
        providerOptions: {
          android: { provider: 'debug' | 'playIntegrity' };
          apple: { provider: 'debug' | 'appAttestWithDeviceCheckFallback' };
        };
      };
      isTokenAutoRefreshEnabled: boolean;
    },
  ) => Promise<unknown>;
}

/**
 * The App Check pieces, or null on a build without them. Never throws.
 *
 * Two requires rather than one because the app handle and the initialiser live
 * in different packages, and either can be missing independently — an older
 * binary has `/app` (phone sign-in has needed it since it shipped) but no
 * `/app-check`. Returning null unless *both* are present is what keeps that
 * build running instead of dying on a property of undefined.
 */
export function loadFirebaseAppCheck(): FirebaseAppCheck | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const app = require('@react-native-firebase/app') as { getApp?: () => unknown };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const check = require('@react-native-firebase/app-check') as {
      initializeAppCheck?: FirebaseAppCheck['initializeAppCheck'];
    };
    if (typeof app.getApp !== 'function' || typeof check.initializeAppCheck !== 'function') {
      return null;
    }
    return { getApp: app.getApp, initializeAppCheck: check.initializeAppCheck };
  } catch {
    return null;
  }
}
