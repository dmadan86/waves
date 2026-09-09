/* eslint-disable no-restricted-imports -- this module is the seam; it is the one place allowed to name expo-router's router. */
import {
  router as expoRouter,
  useRouter as useExpoRouter,
  type ImperativeRouter,
} from 'expo-router';

import { createNavigationGuard } from './navigationGuard';

/**
 * The app's router.
 *
 * Identical to expo-router's, except that a forward navigation to a
 * destination it has just been asked for is dropped. Import `router` from here,
 * not from `expo-router` — the ESLint rule in `eslint.config.js` enforces it,
 * because a screen that reaches past this is a screen that opens twice on a
 * double tap.
 *
 * Wrapping rather than patching expo-router's own object on purpose: the
 * singleton is a plain mutable export today, so reassigning its methods at the
 * root would have worked and needed no call-site changes at all — and would
 * have been invisible, unsearchable, and one refactor upstream from silently
 * doing nothing. A named module that lint keeps honest is worth the import
 * sweep.
 *
 * `back`, `dismiss` and `dismissAll` are not guarded — leaving a screen must
 * always be answered, and the system back gesture never comes through here
 * anyway — but they do clear the guard, so walking back out of a screen and
 * straight into it again works.
 */
const guard = createNavigationGuard();

export const router: ImperativeRouter = {
  ...expoRouter,

  push: (href, options) => {
    if (guard.allow('push', href)) expoRouter.push(href, options);
  },
  navigate: (href, options) => {
    if (guard.allow('navigate', href)) expoRouter.navigate(href, options);
  },
  replace: (href, options) => {
    if (guard.allow('replace', href)) expoRouter.replace(href, options);
  },
  dismissTo: (href, options) => {
    if (guard.allow('dismissTo', href)) expoRouter.dismissTo(href, options);
  },

  back: () => {
    guard.reset();
    expoRouter.back();
  },
  dismiss: (count) => {
    guard.reset();
    expoRouter.dismiss(count);
  },
  dismissAll: () => {
    guard.reset();
    expoRouter.dismissAll();
  },
};

/**
 * The hook form, for the handful of places that take the router from context.
 * It returns the same guarded object — expo-router's `useRouter` hands back the
 * imperative singleton, so there is nothing per-screen to preserve.
 */
export function useRouter(): ImperativeRouter {
  // Called so this stays a real hook if expo-router ever gives it per-tree
  // state; the value it returns is deliberately the guarded one.
  useExpoRouter();
  return router;
}
