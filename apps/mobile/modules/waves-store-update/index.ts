// Google Play in-app updates, Android only. No public JS surface here: the app
// reaches the native module through `src/lib/storeUpdate.tsx`, which resolves it
// optionally so builds without it (and iOS, which has no such API) stay no-ops.
// Autolinking discovers the module from expo-module.config.json; this file only
// marks the package as a module directory.
export {};
