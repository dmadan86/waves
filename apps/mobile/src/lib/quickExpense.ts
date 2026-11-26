/** Pure rules for the quick expense sheet, kept out of the component so they can be tested. */

/** 'personal' is the private ledger; anything else is a group id. */
export type QuickDestination = string | 'personal';

/**
 * Where a quick expense goes when nothing has been tapped: the most recent
 * group chip, else Just me when the private ledger is offered, else nothing.
 */
export function defaultDestination(
  chipIds: readonly string[],
  personalOffered: boolean,
): QuickDestination | null {
  return chipIds[0] ?? (personalOffered ? 'personal' : null);
}

/** The summary bar's sentence. `template` carries `{count}`; Just me and
 *  "kept as a draft" cases pass their own copy. */
export function quickSummary(template: string, count: number): string {
  return template.replace('{count}', String(count));
}
