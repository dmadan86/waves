/**
 * Bank statement import: the numbers every layer must agree on.
 *
 * The edge function enforces them, the app plans around them. They live here so
 * a screen can say "up to 60 pages" without a round trip, and so a test can pin
 * that the two never drift apart (the database is still what refuses the import).
 */

/** Rows one file may yield. More than this is not a statement, it is a ledger. */
export const STATEMENT_MAX_ROWS = 5000;
/** The source file, as picked. Checked on the device before anything is read. */
export const STATEMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Pages of one PDF. */
export const STATEMENT_MAX_PAGES = 60;
/** Pages sent in one request; a file longer than this goes in several. */
export const STATEMENT_PAGES_PER_REQUEST = 5;
/** Most requests one file can take: 60 pages in chunks of 5. */
export const STATEMENT_MAX_CHUNKS = Math.ceil(STATEMENT_MAX_PAGES / STATEMENT_PAGES_PER_REQUEST);
/** Characters of redacted text in one request. A dense page is ~4k. */
export const STATEMENT_MAX_CHARS_PER_REQUEST = 60_000;
/** Page images in one request. */
export const STATEMENT_MAX_IMAGES_PER_REQUEST = 3;
