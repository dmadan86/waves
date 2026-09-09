/**
 * "The app reads the other way now — open it again?"
 *
 * React Native decides the layout direction natively, before any JavaScript, so
 * choosing Arabic on an English launch (or the reverse) changes nothing until
 * the app is opened again. `LanguageProvider` knows that the moment the choice
 * is made — and cannot say so, because it is the outermost provider in the tree
 * and there is no themed surface above it to draw on. It used to reach past all
 * of that for `Alert.alert`, which is the borrowed native window this app has
 * stopped using (A66).
 *
 * So the provider raises a value and this draws it, from inside `DialogProvider`
 * where the app's own dialog exists. It renders nothing itself.
 *
 * The words come from the language *just chosen* rather than from `useStrings`.
 * They are the same table in the ordinary case, but this is the one screen in
 * the app whose whole subject is a language having just changed, and the one
 * language the person has said they read is the one they picked.
 */

import { useEffect } from 'react';

import { STRINGS_BY_LANGUAGE } from '@/i18n';
import { useLanguage } from '@/i18n/language';
import { useDialog } from '@/lib/dialog';
import { canRestart, restartApp } from '@/lib/restart';

export function LanguageRestartPrompt(): null {
  const { restartPrompt, clearRestartPrompt } = useLanguage();
  const { confirm, notify } = useDialog();

  useEffect(() => {
    if (restartPrompt === null) return;
    const { language, rtl } = restartPrompt;
    const words = STRINGS_BY_LANGUAGE[language];
    // Consumed as it is read, so a re-render never asks twice. Clearing here
    // rather than after the answer also means the question survives nothing:
    // somebody who changes their mind and picks a third language gets one
    // prompt about where they ended up, not a queue of where they have been.
    clearRestartPrompt();

    // Builds carrying `expo-updates` can restart themselves, so they offer
    // rather than instruct. Older binaries — and any build that refuses the
    // reload — still get the sentence that was always true.
    if (canRestart()) {
      void confirm({
        title: words.account.restartTitle,
        body: rtl ? words.account.restartNowMirror : words.account.restartNowUnmirror,
        confirmLabel: words.account.restartNow,
        cancelLabel: words.misc.notNow,
      }).then((now) => {
        if (now) void restartApp();
      });
    } else {
      void notify({
        title: words.account.restartTitle,
        body: rtl ? words.signIn.restartToMirror : words.signIn.restartToUnmirror,
        okLabel: words.common.ok,
      });
    }
  }, [restartPrompt, clearRestartPrompt, confirm, notify]);

  return null;
}
