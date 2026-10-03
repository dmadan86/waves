// Google sign-in through `GIDSignIn` directly, with a caller-supplied nonce —
// iOS only. See `WavesGoogleNonceModule.swift` for why this exists:
// `@react-native-google-signin/google-signin`'s own `signIn()` has no nonce
// parameter, so there is no way to bind the ID token it returns to a value
// this app still holds.
//
// No public JS surface here: `src/lib/nativeIdentity.ts` reaches the native
// module through `requireOptionalNativeModule('WavesGoogleNonce')`, which is
// also what keeps a build that predates this module (or Android, which never
// loads it) a plain fall-through rather than a crash. Autolinking discovers
// the module from `expo-module.config.json`; this file only marks the
// package as a module directory.
export {};
