/**
 * The one place `@react-native-firebase/auth` is named.
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
