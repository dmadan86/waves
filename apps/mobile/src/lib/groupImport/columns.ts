/**
 * The Columns step's edits to a detected layout.
 *
 * `detectLayout` reads the header and guesses which column is which; the person
 * can correct it. A correction is a new layout (the old one is never mutated),
 * and `draftFromTable` is simply run again, so the preview under the dropdowns is
 * the real reader's output and not a second opinion of it.
 */

import type { DetectedLayout, FieldKey, PersonColumn } from '@waves/core';

/** What a column can be told it is. `person` is "the amount this person owes". */
export const COLUMN_CHOICES = [
  'date',
  'description',
  'amount',
  'currency',
  'paid_by',
  'split',
  'category',
  'type',
  'person',
  'ignore',
] as const;
export type ColumnChoice = (typeof COLUMN_CHOICES)[number];

const FIELD_CHOICES: ReadonlySet<string> = new Set(
  COLUMN_CHOICES.filter((choice) => choice !== 'person' && choice !== 'ignore'),
);

/** What the layout currently says about one column. */
export function choiceForColumn(layout: DetectedLayout, column: number): ColumnChoice {
  if (layout.personColumns.some((entry) => entry.column === column)) return 'person';
  for (const [field, index] of Object.entries(layout.columns)) {
    if (index === column && FIELD_CHOICES.has(field)) return field as ColumnChoice;
  }
  return 'ignore';
}

/** The layout with `column` told to be `choice`, and whatever had that job before released. */
export function remapColumn(
  layout: DetectedLayout,
  header: readonly string[],
  column: number,
  choice: ColumnChoice,
): DetectedLayout {
  const columns: Partial<Record<FieldKey, number>> = {};
  for (const [field, index] of Object.entries(layout.columns)) {
    if (index !== column) columns[field as FieldKey] = index;
  }
  const personColumns: PersonColumn[] = layout.personColumns.filter(
    (entry) => entry.column !== column,
  );

  if (choice === 'person') {
    const name = (header[column] ?? '').trim();
    personColumns.push({ name: name || `#${column + 1}`, column });
  } else if (choice !== 'ignore') {
    columns[choice as FieldKey] = column;
  }
  return { ...layout, columns, personColumns };
}

/** Whether the layout names the minimum the reader needs: an amount, or people's amounts. */
export function layoutIsReadable(layout: DetectedLayout): boolean {
  return (
    layout.headerRow >= 0 &&
    (layout.columns.amount !== undefined || layout.personColumns.length > 0)
  );
}
