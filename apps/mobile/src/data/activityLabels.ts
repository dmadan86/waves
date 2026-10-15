/**
 * The import lines of the activity feed in one language.
 *
 * Apart from `data/activity.ts` (which stays free of the locale tables so the
 * pure wording tests, and anything that imports it, need no native modules)
 * because it needs `plural`, and `@/i18n` reads the device locale.
 */

import { plural, type PluralForms } from '@/i18n';

import type { ActivityLabels } from './activity';

/** The import lines in one locale, from the `activityScreen` strings. */
export function activityLabels(
  locale: string,
  strings: {
    importedHeadline: PluralForms;
    importedSentence: PluralForms;
    importUndoneHeadline: string;
    importUndoneSentence: string;
  },
): ActivityLabels {
  return {
    importedHeadline: (count) => plural(locale, count, strings.importedHeadline),
    importedSentence: (who, count) =>
      plural(locale, count, strings.importedSentence).replaceAll('{who}', who),
    importUndoneHeadline: strings.importUndoneHeadline,
    importUndoneSentence: (who) => strings.importUndoneSentence.replaceAll('{who}', who),
  };
}
