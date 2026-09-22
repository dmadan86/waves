'use client';

/**
 * Turning an export the server built into a file the browser keeps.
 *
 * `export-data` replies with bytes to an authenticated call, so there is no
 * address a browser could simply point at — the file has to be made here out of
 * what came back. Two pages were each doing that inline and only one format
 * deep: the group page decoded nothing and said so in a comment, and the
 * delete-account page copied the same four lines. A PDF comes back base64, so
 * "the text formats work" is exactly the bug you get when a third caller offers
 * PDF and hands somebody a file full of the letters that spell one.
 *
 * `toBlob` is the whole decision and is deliberately free of the DOM, so a test
 * can read it. `saveFile` is the two lines of browser around it.
 */

import type { ExportResult } from '@waves/api-client';

/**
 * The bytes, whichever way they were sent.
 *
 * `encoding` is absent on the text formats and `'base64'` on the PDF. Decoding
 * happens a byte at a time rather than through `TextEncoder`, because the
 * string `atob` returns is Latin-1: every character is one byte, and encoding
 * it as UTF-8 would silently double the length of every byte above 0x7f and
 * corrupt the file.
 */
export function toBlob(file: ExportResult): Blob {
  if (file.encoding !== 'base64') return new Blob([file.content], { type: file.contentType });
  const binary = atob(file.content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: file.contentType });
}

/** Hand the file to the browser under the name the server chose. */
export function saveFile(file: ExportResult): void {
  const url = URL.createObjectURL(toBlob(file));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  // Revoked on the next tick: revoking synchronously can beat the click in some
  // browsers and hand the person an empty file.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
