/**
 * The conversation between the app and the hidden WebView that hosts pdf.js.
 *
 * Everything here is pure so it is unit-tested without a WebView: the message
 * shapes (and the check that a message from the page is one of them), base64
 * chunking, turning positioned text items into lines, deciding that a page is a
 * scan, and mapping pdf.js's error names onto the reasons the screen speaks.
 * The page side lives in `scripts/pdf-reader-glue.js`.
 *
 * Nothing in these messages is ever logged. The password travels app -> page in
 * one `open` or `password` message and is not kept anywhere after it.
 */

/** One text run on a page: `[text, x, y, width, height]` in PDF user-space units, y up. */
export type PdfTextItem = readonly [string, number, number, number, number];

export type ToPage =
  | { readonly t: 'begin' }
  | { readonly t: 'chunk'; readonly data: string }
  | { readonly t: 'open'; readonly password?: string }
  | { readonly t: 'password'; readonly password: string }
  | { readonly t: 'page'; readonly n: number }
  | { readonly t: 'render'; readonly n: number; readonly maxWidth: number }
  | { readonly t: 'close' };

export type FromPage =
  | { readonly t: 'ready' }
  | { readonly t: 'opened'; readonly pages: number }
  | { readonly t: 'items'; readonly n: number; readonly items: readonly PdfTextItem[] }
  | { readonly t: 'image'; readonly n: number; readonly base64: string }
  | { readonly t: 'error'; readonly name: string; readonly code: number | null };

/** pdf.js `PasswordResponses`: 1 asks for a password, 2 says the one given was wrong. */
const NEED_PASSWORD = 1;
const INCORRECT_PASSWORD = 2;

export type PdfErrorReason = 'password_needed' | 'wrong_password' | 'unreadable';

/** What a pdf.js error means to the person. Unknown errors are an unreadable file. */
export function mapPdfError(name: string, code: number | null): PdfErrorReason {
  if (name === 'PasswordException') {
    return code === INCORRECT_PASSWORD
      ? 'wrong_password'
      : code === NEED_PASSWORD || code === null
        ? 'password_needed'
        : 'unreadable';
  }
  return 'unreadable';
}

function isItem(value: unknown): value is PdfTextItem {
  return (
    Array.isArray(value) &&
    value.length === 5 &&
    typeof value[0] === 'string' &&
    value.slice(1).every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/**
 * Maximum raw byte length accepted from the page before JSON parsing.
 *
 * An `items` page carries positioned text runs (~50 bytes each × ~500 items =
 * ~25 kB). An `image` page carries a base64-encoded JPEG at PDF_SCAN_WIDTH_PX
 * (1400 px), which in practice is well under 1 MB. 10 MB gives plenty of
 * headroom for every legitimate payload while blocking a maliciously oversized
 * string before it ever touches JSON.parse.
 */
export const RAW_MESSAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** A message from the page, or null when it is not one we know. */
export function parseFromPage(raw: string): FromPage | null {
  // Reject oversized payloads before parsing — a string's .length is in UTF-16
  // code units, which is >= the UTF-8 byte count, so this is a safe upper bound.
  if (raw.length > RAW_MESSAGE_MAX_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  switch (m.t) {
    case 'ready':
      return { t: 'ready' };
    case 'opened':
      return typeof m.pages === 'number' && Number.isInteger(m.pages) && m.pages >= 0
        ? { t: 'opened', pages: m.pages }
        : null;
    case 'items':
      return typeof m.n === 'number' &&
        Number.isInteger(m.n) &&
        m.n >= 1 &&
        Array.isArray(m.items) &&
        m.items.every(isItem)
        ? { t: 'items', n: m.n, items: m.items as PdfTextItem[] }
        : null;
    case 'image':
      return typeof m.n === 'number' &&
        Number.isInteger(m.n) &&
        m.n >= 1 &&
        typeof m.base64 === 'string'
        ? { t: 'image', n: m.n, base64: m.base64 }
        : null;
    case 'error':
      return typeof m.name === 'string'
        ? { t: 'error', name: m.name, code: typeof m.code === 'number' ? m.code : null }
        : null;
    default:
      return null;
  }
}

/** The script that hands one message to the page. JSON is the whole quoting story. */
export function injectionFor(message: ToPage): string {
  return `window.__rx(${JSON.stringify(message)});true;`;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 without `btoa`/`Buffer`, which a React Native runtime may not have. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  // Built in slices so a 10 MB file does not make one 13 MB string by repeated +=.
  for (let start = 0; start < bytes.length; start += 3 * 16384) {
    const end = Math.min(bytes.length, start + 3 * 16384);
    let out = '';
    let i = start;
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
      out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
    }
    if (i < end) {
      const rest = end - i;
      const n = (bytes[i]! << 16) | ((rest === 2 ? bytes[i + 1]! : 0) << 8);
      out +=
        B64[(n >> 18) & 63]! +
        B64[(n >> 12) & 63]! +
        (rest === 2 ? B64[(n >> 6) & 63]! : '=') +
        '=';
    }
    parts.push(out);
  }
  return parts.join('');
}

/** Pieces of a base64 string, each a whole number of 4-character groups so any piece decodes alone. */
export function chunkBase64(base64: string, size = 1024 * 1024): string[] {
  const step = Math.max(4, size - (size % 4));
  const chunks: string[] = [];
  for (let at = 0; at < base64.length; at += step) chunks.push(base64.slice(at, at + step));
  return chunks;
}

/** Fewer visible characters than this and the page has no text layer worth reading. */
export const SCANNED_PAGE_MAX_CHARS = 40;

/** A page whose text layer is empty or a stray footer: a scan, to be read as an image. */
export function isScannedPage(items: readonly PdfTextItem[]): boolean {
  let visible = 0;
  for (const item of items) {
    visible += item[0].replace(/\s+/g, '').length;
    if (visible >= SCANNED_PAGE_MAX_CHARS) return false;
  }
  return true;
}

/**
 * Positioned text runs into lines, top to bottom and left to right.
 *
 * A bank's PDF is a table drawn as separate runs. Runs whose baselines are within
 * half a line of each other share a row; within a row, a visible gap becomes a
 * space, so `parseStatementText` sees the same "date narration amount balance"
 * line it was written against.
 */
export function itemsToText(items: readonly PdfTextItem[]): string {
  const runs = items.filter((item) => item[0].trim() !== '');
  if (runs.length === 0) return '';
  const sorted = [...runs].sort((a, b) => b[2] - a[2] || a[1] - b[1]);

  const rows: PdfTextItem[][] = [];
  let rowY = Number.NaN;
  let rowTolerance = 0;
  for (const run of sorted) {
    const height = run[4] > 0 ? run[4] : 8;
    if (rows.length > 0 && Math.abs(run[2] - rowY) <= rowTolerance) {
      rows[rows.length - 1]!.push(run);
    } else {
      rows.push([run]);
      rowY = run[2];
      rowTolerance = Math.max(2, height * 0.5);
    }
  }

  return rows
    .map((row) => {
      const ordered = [...row].sort((a, b) => a[1] - b[1]);
      let line = '';
      let end = Number.NEGATIVE_INFINITY;
      for (const run of ordered) {
        const text = run[0];
        const height = run[4] > 0 ? run[4] : 8;
        if (line !== '') {
          const gap = run[1] - end;
          const joined = /\s$/.test(line) || /^\s/.test(text);
          if (!joined && gap > height * 0.15) line += ' ';
        }
        line += text;
        end = Math.max(end, run[1] + run[3]);
      }
      return line.replace(/[ \t]+/g, ' ').trim();
    })
    .filter((line) => line !== '')
    .join('\n');
}
