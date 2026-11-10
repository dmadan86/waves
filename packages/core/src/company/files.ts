/** Company Files: pure helpers for the Files screen (type pills, search, who may pick which visibility). */

export type CompanyFileVisibility = 'everyone' | 'managers' | 'owners';
export type CompanyFileKind = 'file' | 'link';
export type CompanyFileType = 'documents' | 'images' | 'sheets' | 'others' | 'links';
export type CompanyFileFilter = 'all' | CompanyFileType;

export interface CompanyFileItem {
  readonly kind: CompanyFileKind;
  readonly name: string;
  readonly mime?: string | null;
}

const DOC_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]);
const SHEET_MIMES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);
const EXT_MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  zip: 'application/zip',
};
/** The types the server accepts (the same list as r2-sign and the database). */
const ACCEPTED = new Set(Object.values(EXT_MIME));

/** The mime type a picked file uploads as: the picker's own when the server accepts it, else guessed from the name. */
export function uploadMime(name: string, pickerMime?: string | null): string | null {
  if (pickerMime && ACCEPTED.has(pickerMime)) return pickerMime;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return EXT_MIME[ext] ?? null;
}

export function companyFileType(item: CompanyFileItem): CompanyFileType {
  if (item.kind === 'link') return 'links';
  const mime = item.mime ?? uploadMime(item.name) ?? '';
  if (mime.startsWith('image/')) return 'images';
  if (DOC_MIMES.has(mime)) return 'documents';
  if (SHEET_MIMES.has(mime)) return 'sheets';
  return 'others';
}

/** Items matching a type pill and a search box (name, case-insensitive). */
export function filterCompanyFiles<T extends CompanyFileItem>(
  items: readonly T[],
  filter: CompanyFileFilter,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (filter === 'all' || companyFileType(item) === filter) &&
      (q === '' || item.name.toLowerCase().includes(q)),
  );
}

/** The visibilities a person may choose: a manager cannot hide an item from themself. */
export function visibilityChoices(role: 'admin' | 'manager'): CompanyFileVisibility[] {
  return role === 'admin' ? ['everyone', 'managers', 'owners'] : ['everyone', 'managers'];
}

/** A link address as typed: https:// is added when no scheme was given; null when it is not an http(s) address. */
export function normaliseLinkUrl(input: string): string | null {
  const text = input.trim();
  if (text === '' || /\s/.test(text)) return null;
  const full = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  return /^https?:\/\/[^\s/]+/i.test(full) && full.length <= 2048 ? full : null;
}
