const path = require('path');

const expoConfig = require('eslint-config-expo/flat');

/**
 * Said once, because the two selectors that catch a native alert are two
 * spellings of the same mistake.
 */
const ALERT_MESSAGE =
  'Use `useDialog()` (@/lib/dialog) for a question and `useToast()` (@/lib/toast) for a notice. `Alert.alert` is the native dialog this app replaced.';

/**
 * Expo's shared config already turns on `import/no-unresolved` and wires an
 * `import/resolver.typescript` entry — but that only resolves the `@/*` path
 * alias if `eslint-import-resolver-typescript` is actually installed. It has
 * been reaching us transitively through `eslint-config-expo`, which is fragile:
 * a hoist change or a fresh install in a different layout (e.g. a reviewer's CI)
 * drops the resolver and every `@/lib/...` import lights up as unresolved.
 *
 * So we depend on the resolver directly (see package.json) and point it at this
 * app's tsconfig here, making `@/*` resolution explicit and layout-independent
 * rather than a side effect of Expo's dependency tree.
 */
module.exports = [
  ...expoConfig,
  {
    settings: {
      // eslint-plugin-react (via eslint-config-expo) auto-detects the installed
      // React version by calling context.getFilename(), which ESLint 10 removed —
      // that path throws before any rule runs. Pinning the version skips detection.
      // Keep in sync with the `react` dependency in package.json.
      react: { version: '19.2' },
      'import/resolver': {
        typescript: {
          project: path.join(__dirname, 'tsconfig.json'),
        },
      },
    },
  },
  {
    ignores: ['dist/*', '.expo/*', 'expo-env.d.ts'],
  },
  // Keep the backend seam intact: everything talks to the `Backend` port
  // (`@/lib/backend`); only the adapter is allowed to name the vendor. A stray
  // `import { supabase }` re-couples the app and must fail here, not in review.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message:
                'Import through the backend port (`@/lib/backend`). Only lib/supabase.ts (the adapter) may name the vendor.',
            },
            {
              name: '@/lib/supabase',
              message: 'Import `backend` from `@/lib/backend`, not the Supabase client directly.',
            },
            {
              // The stock alert is a different application's window borrowed for
              // a moment — grey slab, square corners, two identical capitals —
              // over a screen of rounded cards and brand purple, and it can be
              // told nothing but strings. Every one of the forty-nine call sites
              // it had is now `useDialog()` or `useToast()`; this is what stops
              // the fiftieth. Everything else in react-native is fine.
              name: 'react-native',
              importNames: ['Alert'],
              message:
                'Use `useDialog()` (@/lib/dialog) for a question and `useToast()` (@/lib/toast) for a notice. `Alert` is the native dialog this app replaced.',
            },
            {
              // One tap, one screen. `@/lib/navigation` is expo-router's router
              // with a short guard in front of it, so a double tap cannot push
              // the same route twice — a bug you only see on a real phone, and
              // one that comes straight back the moment a screen imports the
              // raw router again.
              name: 'expo-router',
              importNames: ['router', 'useRouter'],
              message:
                'Import `router` / `useRouter` from `@/lib/navigation` — the guarded router. Everything else in expo-router is fine to import directly.',
            },
          ],
          patterns: [
            {
              group: ['**/lib/supabase'],
              message: 'Import through the backend port (`@/lib/backend`).',
            },
          ],
        },
      ],
      // The import rule cannot see `require('react-native').Alert`, and this
      // repo reaches for a lazy `require` on purpose (see lib/restart.ts, where
      // a hoisted import of a missing native module kills the app at launch).
      // This catches the call however `Alert` was got hold of.
      'no-restricted-syntax': [
        'error',
        {
          // `Alert.alert(…)`, however `Alert` was bound — including out of a
          // destructured `require`.
          selector: "MemberExpression[object.name='Alert'][property.name='alert']",
          message: ALERT_MESSAGE,
        },
        {
          // `RN.Alert.alert(…)` and `require('react-native').Alert.alert(…)`.
          selector: "MemberExpression[property.name='alert'][object.property.name='Alert']",
          message: ALERT_MESSAGE,
        },
      ],
    },
  },
  {
    // The adapter and the port are the two places the vendor is allowed.
    files: ['**/lib/supabase.ts', '**/lib/backend/index.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
