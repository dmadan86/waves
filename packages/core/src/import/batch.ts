/**
 * Importing into a group is done in batches (`import_batches`, migration
 * `group_import_batches`). These are the numbers the phone and the database
 * have to agree on.
 */

/**
 * How long after an import its person (or an admin) can still undo it with one
 * tap. `waves_undo_import` holds the same number in SQL; `group-import.test.ts`
 * fails if the two drift.
 */
export const IMPORT_UNDO_WINDOW_HOURS = 24;

/** Rows per `waves_import_into_group` call. The server refuses more than 500. */
export const IMPORT_CHUNK_SIZE = 250;

/** The most rows one `waves_import_into_group` call accepts (TOO_MANY_ROWS). */
export const IMPORT_MAX_ROWS_PER_CALL = 500;

/** Whether an import made at `createdAt` can still be undone at `now`. */
export function canUndoImport(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() <= IMPORT_UNDO_WINDOW_HOURS * 60 * 60 * 1000;
}
