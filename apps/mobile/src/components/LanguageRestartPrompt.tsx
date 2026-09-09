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

import { useEffect, useRef } from 'react';

import { STRINGS_BY_LANGUAGE } from '@/i18n';
import { useRestartPrompt } from '@/i18n/language';
import { useDialog } from '@/lib/dialog';
import { canRestart, restartApp } from '@/lib/restart';

export function LanguageRestartPrompt(): null {
  const { prompt, clear } = useRestartPrompt();
  const { confirm, notify } = useDialog();
  // Whether one is already on screen. Flipping the direction twice in a sitting
  // — English, Arabic, Hindi, Arabic — raises the question twice, and the second
  // is word for word the first: the only thing it could say is that the app will
  // mirror when it is opened again, which is what is already being read. Without
  // this the second one queues behind the first and has to be dismissed twice.
  const open = useRef(false);

  useEffect(() => {
    if (prompt === null) return;
    const { language, rtl } = prompt;
    const words = STRINGS_BY_LANGUAGE[language];
    // Consumed as it is read, so a re-render never asks twice.
    clear();
    if (open.current) return;
    open.current = true;
    const done = (): void => {
      open.current = false;
    };

    // Builds carrying `expo-updates` can restart themselves, so they offer
    // rather than instruct. Older binaries — and any build that refuses the
    // reload — still get the sentence that was always true.
    if (canRestart()) {
      void confirm({
        title: words.account.restartTitle,
        body: rtl ? words.account.restartNowMirror : words.account.restartNowUnmirror,
        confirmLabel: words.account.restartNow,
        cancelLabel: words.misc.notNow,
      })
        .then((now) => {
          if (now) void restartApp();
        })
        .finally(done);
    } else {
      void notify({
        title: words.account.restartTitle,
        body: rtl ? words.signIn.restartToMirror : words.signIn.restartToUnmirror,
        okLabel: words.common.ok,
      }).finally(done);
    }
  }, [prompt, clear, confirm, notify]);

  return null;
}
