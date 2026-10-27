/**
 * The localized lines of the activity feed in one language: the import lines
 * and the group-settings / people lines.
 *
 * Apart from `data/activity.ts` (which stays free of the locale tables so the
 * pure wording tests, and anything that imports it, need no native modules)
 * because it needs `plural`, and `@/i18n` reads the device locale.
 */

import { plural, type PluralForms } from '@/i18n';

import {
  type ActivityLabels,
  type GroupChangeStrings,
  type GroupTypeNames,
  groupChangeLabels,
} from './activity';

/**
 * The lines in one locale, from the `activityScreen` strings. `typeNames`
 * names each kind of group ('trip' → "Trip") in the same language, for
 * "Changed the group type to Trip"; left out, the keys fall back to English.
 */
export function activityLabels(
  locale: string,
  strings: {
    importedHeadline: PluralForms;
    importedSentence: PluralForms;
    importUndoneHeadline: string;
    importUndoneSentence: string;
    group: GroupChangeStrings;
  },
  typeNames?: GroupTypeNames,
): ActivityLabels {
  return {
    importedHeadline: (count) => plural(locale, count, strings.importedHeadline),
    importedSentence: (who, count) =>
      plural(locale, count, strings.importedSentence).replaceAll('{who}', who),
    importUndoneHeadline: strings.importUndoneHeadline,
    importUndoneSentence: (who) => strings.importUndoneSentence.replaceAll('{who}', who),
    group: groupChangeLabels(locale, strings.group, typeNames),
  };
}

/** The batch headline uses the departed member recorded in the activity payload. */
export function resplitActivityLabel(
  entry: { verb: string; payload: Record<string, unknown> },
  locale: string,
  strings: { activity: PluralForms; activityUndone: string },
  someone: string,
): string | null {
  const template =
    entry.verb === 'resplit'
      ? plural(locale, Number(entry.payload.count ?? 0), strings.activity)
      : entry.verb === 'resplit_undone'
        ? strings.activityUndone
        : null;
  const name = entry.payload.name ?? entry.payload.member_name ?? entry.payload.memberName;
  return (
    template?.replaceAll('{name}', typeof name === 'string' && name.trim() ? name : someone) ?? null
  );
}
