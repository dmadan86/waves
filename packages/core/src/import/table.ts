/**
 * Bytes to text to a table of cells.
 *
 * Every importer starts here, so this is where "a CSV" stops being one thing
 * and becomes the dozen things people actually have: Excel's `;`-separated
 * Windows-1252 export, a phone's UTF-16 text file, a Google Sheet with a
 * description that runs over two lines.
 *
 * No `TextDecoder`: Hermes does not implement every label, and a decoder that
 * is missing on the device that matters is worse than forty lines of our own.
 */

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface DecodedText {
  readonly text: string;
  readonly encoding: TextEncoding;
  /** True when the bytes were not valid for the encoding and some characters were replaced. */
  readonly lossy: boolean;
}

/** Windows-1252 differs from Latin-1 only in 0x80..0x9F; the five holes become U+FFFD. */
const CP1252_HIGH = [
  0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0xfffd, 0x017d, 0xfffd, 0xfffd, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0xfffd, 0x017e, 0x0178,
] as const;

const CHUNK = 8192;

function fromCodeUnits(units: readonly number[]): string {
  let out = '';
  for (let start = 0; start < units.length; start += CHUNK) {
    out += String.fromCharCode(...units.slice(start, start + CHUNK));
  }
  return out;
}

function fromCodePoints(points: readonly number[]): string {
  let out = '';
  for (let start = 0; start < points.length; start += CHUNK) {
    out += String.fromCodePoint(...points.slice(start, start + CHUNK));
  }
  return out;
}

/** Strict UTF-8: null on any malformed, overlong, surrogate or out-of-range sequence. */
function decodeUtf8Strict(bytes: Uint8Array, start: number): string | null {
  const points: number[] = [];
  let index = start;
  while (index < bytes.length) {
    const lead = bytes[index]!;
    if (lead < 0x80) {
      points.push(lead);
      index += 1;
      continue;
    }
    let needed: number;
    let point: number;
    let min: number;
    if (lead >= 0xc2 && lead <= 0xdf) {
      needed = 1;
      point = lead & 0x1f;
      min = 0x80;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      needed = 2;
      point = lead & 0x0f;
      min = 0x800;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      needed = 3;
      point = lead & 0x07;
      min = 0x10000;
    } else {
      return null;
    }
    for (let offset = 1; offset <= needed; offset += 1) {
      const next = bytes[index + offset];
      if (next === undefined || (next & 0xc0) !== 0x80) return null;
      point = (point << 6) | (next & 0x3f);
    }
    if (point < min || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return null;
    points.push(point);
    index += needed + 1;
  }
  return fromCodePoints(points);
}

function decodeUtf16(bytes: Uint8Array, start: number, littleEndian: boolean): DecodedText {
  const units: number[] = [];
  for (let index = start; index + 1 < bytes.length; index += 2) {
    const a = bytes[index]!;
    const b = bytes[index + 1]!;
    units.push(littleEndian ? a | (b << 8) : (a << 8) | b);
  }
  const lossy = (bytes.length - start) % 2 === 1;
  return { text: fromCodeUnits(units), encoding: littleEndian ? 'utf-16le' : 'utf-16be', lossy };
}

function decodeWindows1252(bytes: Uint8Array): string {
  const units: number[] = [];
  for (const byte of bytes) {
    units.push(byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80]! : byte);
  }
  return fromCodeUnits(units);
}

/**
 * The text in a file's bytes.
 *
 * A byte-order mark decides it. Without one, strict UTF-8 is tried first (it
 * almost never matches by accident), then Windows-1252, which is what Excel
 * writes on Windows. Windows-1252 maps nearly every byte, so the fallback
 * reads; it only reports `lossy` when it had to use one of the five unmapped
 * bytes.
 */
export function decodeBytes(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const text = decodeUtf8Strict(bytes, 3);
    if (text !== null) return { text, encoding: 'utf-8', lossy: false };
    return { text: decodeWindows1252(bytes.subarray(3)), encoding: 'windows-1252', lossy: true };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(bytes, 2, true);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes, 2, false);

  const utf8 = decodeUtf8Strict(bytes, 0);
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8', lossy: false };

  const text = decodeWindows1252(bytes);
  return { text, encoding: 'windows-1252', lossy: text.includes('�') };
}

export const DELIMITERS = [',', ';', '\t', '|'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/** Excel's `sep=;` first line, which says outright what the delimiter is. */
const SEP_LINE = /^sep=(.)\s*(?:\r\n|\r|\n|$)/i;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Counts of each candidate delimiter per logical line, outside quotes, for the first lines. */
function delimiterCounts(text: string, maxLines: number): Map<Delimiter, number[]> {
  const counts = new Map<Delimiter, number[]>(DELIMITERS.map((d) => [d, []]));
  let current = new Map<Delimiter, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  let lines = 0;
  let sawContent = false;
  const flush = (): void => {
    if (sawContent) {
      for (const d of DELIMITERS) counts.get(d)!.push(current.get(d)!);
      lines += 1;
    }
    current = new Map(DELIMITERS.map((d) => [d, 0]));
    sawContent = false;
  };
  for (let index = 0; index < text.length && lines < maxLines; index += 1) {
    const char = text[index]!;
    if (char === '"') {
      quoted = !quoted;
      sawContent = true;
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      flush();
    } else {
      if (char.trim() !== '') sawContent = true;
      if (!quoted && (DELIMITERS as readonly string[]).includes(char)) {
        const d = char as Delimiter;
        current.set(d, (current.get(d) ?? 0) + 1);
      }
    }
  }
  if (lines < maxLines) flush();
  return counts;
}

/**
 * The delimiter a file uses: the one with the most consistent non-zero count
 * per line over the first 20 lines. Ties go to the earlier candidate, so a
 * file that is ambiguous reads as a comma-separated one.
 */
export function detectDelimiter(text: string): Delimiter {
  const body = stripBom(text);
  const sep = SEP_LINE.exec(body);
  if (sep && (DELIMITERS as readonly string[]).includes(sep[1]!)) return sep[1] as Delimiter;

  const counts = delimiterCounts(sep ? body.slice(sep[0].length) : body, 20);
  let best: Delimiter = ',';
  let bestScore = 0;
  let bestWidth = 0;
  for (const d of DELIMITERS) {
    const perLine = counts.get(d)!;
    const tally = new Map<number, number>();
    for (const n of perLine) if (n > 0) tally.set(n, (tally.get(n) ?? 0) + 1);
    let modal = 0;
    let score = 0;
    for (const [n, lines] of tally) {
      if (lines > score || (lines === score && n > modal)) {
        modal = n;
        score = lines;
      }
    }
    if (score > bestScore || (score === bestScore && score > 0 && modal > bestWidth)) {
      best = d;
      bestScore = score;
      bestWidth = modal;
    }
  }
  return best;
}

export interface TableRead {
  /** Trimmed cells. Fully blank rows are dropped. */
  readonly rows: readonly (readonly string[])[];
  /** 1-based line each row started on, for messages that say "row 14". */
  readonly lines: readonly number[];
  readonly delimiter: Delimiter;
}

/**
 * A formula-injection guard of our own making: exports prefix a cell that
 * starts `=`, `+`, `-` or `@` with a single quote so a spreadsheet will not run
 * it. Read it back without the quote.
 */
function unguardCell(cell: string): string {
  return /^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell;
}

/**
 * An RFC 4180 state machine over the whole text, so a quoted description with a
 * newline in it stays one cell. Handles `""` escapes and CRLF, CR or LF line
 * ends. A quote only opens a cell when it is the cell's first character; a
 * quote in the middle of a bare cell (`5" nails`) is just a character.
 */
export function readTable(text: string, options: { delimiter?: Delimiter } = {}): TableRead {
  let body = stripBom(text);
  const sep = SEP_LINE.exec(body);
  if (sep) body = body.slice(sep[0].length);
  const delimiter = options.delimiter ?? detectDelimiter(text);

  const rows: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let cellWasQuoted = false;
  let line = 1;
  let rowLine = 1;

  const endCell = (): void => {
    row.push(unguardCell(cell.trim()));
    cell = '';
    cellWasQuoted = false;
  };
  const endRow = (): void => {
    endCell();
    if (row.some((value) => value !== '')) {
      rows.push(row);
      lines.push(rowLine);
    }
    row = [];
  };

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (quoted) {
      if (char === '"') {
        if (body[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else {
        if (char === '\n') line += 1;
        else if (char === '\r' && body[index + 1] !== '\n') line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.trim() === '' && !cellWasQuoted) {
      quoted = true;
      cellWasQuoted = true;
      cell = '';
    } else if (char === delimiter) {
      endCell();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && body[index + 1] === '\n') index += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else {
      cell += char;
    }
  }
  if (cell !== '' || cellWasQuoted || row.length > 0) endRow();

  return { rows, lines, delimiter };
}
