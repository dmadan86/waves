/**
 * The date the Splitwise column was last checked against Splitwise's own
 * pages. It is rendered on the page and in the Markdown twin, because a
 * comparison with no date is a comparison nobody can check.
 *
 * Whoever re-checks the rows moves this date. The source for every row is in
 * the comment block at the top of `src/components/comparison.tsx`.
 */
export const COMPARISON_CHECKED_ON = '2026-09-08';

/**
 * The pages the Splitwise column was read from. Shown under the tables and
 * listed in the Markdown twin, so both representations cite the same four
 * URLs and neither can quietly drop one.
 */
export const COMPARISON_SOURCES = [
  'https://www.splitwise.com/',
  'https://www.splitwise.com/pro',
  'https://kb.splitwise.com/pro/what-is-splitwise-pro',
  'https://dev.splitwise.com/',
] as const;

/** The checked-on date, in the page's own language. */
export function checkedOnDate(locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    // Without this the date is read in the build machine's zone, which can
    // land it a day early.
    timeZone: 'UTC',
  }).format(new Date(`${COMPARISON_CHECKED_ON}T00:00:00Z`));
}
