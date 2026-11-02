/**
 * A public Google Sheet as a table: the sheet's own CSV export, no sign-in.
 *
 * Only an address rebuilt by `sheetCsvUrl` is fetched (docs.google.com over
 * https), the download is capped, and a sheet that is not shared with "anyone
 * with the link" (Google answers with a sign-in page or 401/403/404) is told
 * apart from a network failure so the screen can say what to change.
 */

import { isGoogleHost, MAX_IMPORT_BYTES, sheetCsvUrl, type TableRead } from '@waves/core';

import { GroupImportFileError, tableFromBytes } from '@/lib/groupImport/file';

export type SheetFailure =
  | 'bad_link'
  | 'private'
  | 'too_large'
  | 'network'
  | 'empty'
  | 'too_many_rows'
  | 'encoding'
  | 'unreadable';

export class SheetError extends Error {
  constructor(readonly failure: SheetFailure) {
    super(`sheet import: ${failure}`);
    this.name = 'SheetError';
  }
}

const TIMEOUT_MS = 20_000;

export async function fetchSheetTable(pasted: string): Promise<TableRead> {
  const url = sheetCsvUrl(pasted);
  if (!url) throw new SheetError('bad_link');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let bytes: Uint8Array;
  try {
    const response = await fetch(url, { signal: abort.signal, redirect: 'follow' });
    let finalHost = '';
    try {
      finalHost = new URL(response.url || url).hostname;
    } catch {
      // Keep the empty host: it is refused below.
    }
    if (!isGoogleHost(finalHost)) throw new SheetError('private');
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new SheetError('private');
    }
    if (!response.ok) throw new SheetError('network');
    // A private sheet answers 200 with the sign-in page.
    if (/text\/html/i.test(response.headers.get('content-type') ?? '')) {
      throw new SheetError('private');
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_IMPORT_BYTES) throw new SheetError('too_large');
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMPORT_BYTES) throw new SheetError('too_large');
  } catch (caught) {
    if (caught instanceof SheetError) throw caught;
    throw new SheetError('network');
  } finally {
    clearTimeout(timer);
  }
  try {
    return tableFromBytes(bytes, 'sheet.csv', 'text/csv').table;
  } catch (caught) {
    throw new SheetError(
      caught instanceof GroupImportFileError ? (caught.failure as SheetFailure) : 'unreadable',
    );
  }
}
