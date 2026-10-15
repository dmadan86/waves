// Google Play Install Referrer, Android only. No public JS surface here: the app
// reaches the native module through `src/lib/installReferrer.ts`, which resolves
// it optionally so builds without it (and iOS, which has no such API) read null.
// Autolinking discovers the module from expo-module.config.json; this file only
// marks the package as a module directory.
export {};
