/**
 * What kind of file a person picked for a statement import.
 *
 * Judged by name first and type second, because pickers label things
 * inconsistently (Android reports a .csv as application/vnd.ms-excel often
 * enough that the name has to win, as the group import found).
 */

export type StatementFileKind = 'pdf' | 'csv' | 'xlsx' | 'image';

export function statementFileKind(
  name: string,
  mimeType?: string | null,
): StatementFileKind | null {
  const lower = name.toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();
  if (/\.pdf$/.test(lower)) return 'pdf';
  if (/\.xlsx?$/.test(lower)) return 'xlsx';
  if (/\.(csv|tsv|txt)$/.test(lower)) return 'csv';
  if (/\.(jpe?g|png|webp|heic|heif)$/.test(lower)) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (/spreadsheetml|ms-excel/.test(mime) && !/csv/.test(mime)) return 'xlsx';
  if (/csv|text\/plain/.test(mime)) return 'csv';
  return null;
}

/** The magic bytes of a PDF: `%PDF-`. A renamed file is caught before anything is read. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}
