import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseStatementText } from '@waves/core';

import {
  bytesToBase64,
  chunkBase64,
  injectionFor,
  isScannedPage,
  itemsToText,
  mapPdfError,
  parseFromPage,
  type PdfTextItem,
  type ToPage,
} from '@/lib/statementImport/pdfReaderProtocol';
import { PdfReadSession } from '@/lib/statementImport/pdfReaderSession';

import { buildModule, OUTPUT } from '../scripts/build-pdf-reader.mjs';
import { readFileSync } from 'node:fs';

const item = (
  str: string,
  x: number,
  y: number,
  width = str.length * 5,
  height = 10,
): PdfTextItem => [str, x, y, width, height];

describe('pdf.js error mapping', () => {
  it.each([
    ['PasswordException', 1, 'password_needed'],
    ['PasswordException', 2, 'wrong_password'],
    ['PasswordException', null, 'password_needed'],
    ['PasswordException', 9, 'unreadable'],
    ['InvalidPDFException', null, 'unreadable'],
    ['MissingPDFException', null, 'unreadable'],
    ['Error', null, 'unreadable'],
  ] as const)('%s (%s) is %s', (name, code, reason) => {
    expect(mapPdfError(name, code)).toBe(reason);
  });
});

describe('messages from the page', () => {
  it('accepts the ones the protocol defines', () => {
    expect(parseFromPage('{"t":"ready"}')).toEqual({ t: 'ready' });
    expect(parseFromPage('{"t":"opened","pages":3}')).toEqual({ t: 'opened', pages: 3 });
    expect(parseFromPage('{"t":"error","name":"PasswordException","code":2}')).toEqual({
      t: 'error',
      name: 'PasswordException',
      code: 2,
    });
    expect(parseFromPage('{"t":"items","n":1,"items":[["a",1,2,3,4]]}')).toEqual({
      t: 'items',
      n: 1,
      items: [['a', 1, 2, 3, 4]],
    });
    expect(parseFromPage('{"t":"image","n":2,"base64":"AAAA"}')).toEqual({
      t: 'image',
      n: 2,
      base64: 'AAAA',
    });
  });

  it('refuses anything else', () => {
    expect(parseFromPage('not json')).toBeNull();
    expect(parseFromPage('null')).toBeNull();
    expect(parseFromPage('{"t":"nope"}')).toBeNull();
    expect(parseFromPage('{"t":"opened","pages":-1}')).toBeNull();
    expect(parseFromPage('{"t":"items","n":1,"items":[["a",1,2,3]]}')).toBeNull();
    expect(parseFromPage('{"t":"items","n":1,"items":[[1,1,2,3,4]]}')).toBeNull();
    expect(parseFromPage('{"t":"image","n":1}')).toBeNull();
  });

  it('quotes a message for injection as JSON, a password included', () => {
    const script = injectionFor({ t: 'password', password: `a"b'\\c` });
    expect(script).toBe(`window.__rx({"t":"password","password":"a\\"b'\\\\c"});true;`);
  });
});

describe('base64', () => {
  it.each([0, 1, 2, 3, 4, 5, 100, 49153, 100001])('encodes %s bytes like Buffer', (n) => {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('chunks on whole 4-character groups so each piece decodes alone', () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
    const b64 = bytesToBase64(bytes);
    const chunks = chunkBase64(b64, 102);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) expect(chunk.length % 4).toBe(0);
    expect(chunks.join('')).toBe(b64);
    const decoded = Buffer.concat(chunks.map((c) => Buffer.from(c, 'base64')));
    expect(new Uint8Array(decoded)).toEqual(bytes);
  });
});

describe('scanned page detection', () => {
  it('calls an empty text layer a scan', () => {
    expect(isScannedPage([])).toBe(true);
    expect(isScannedPage([item('', 0, 0), item('  ', 5, 0)])).toBe(true);
  });

  it('calls a lone page-number footer a scan too', () => {
    expect(isScannedPage([item('Page 3 of 9', 250, 20)])).toBe(true);
  });

  it('keeps a page with a real table', () => {
    expect(
      isScannedPage([
        item('01/10/26 UPI-SWIGGY-ORDER-1234 450.00 54,321.50', 5, 700),
        item('Date', 5, 720),
      ]),
    ).toBe(false);
  });
});

describe('text items to lines', () => {
  it('puts runs on one baseline in one line, left to right, and rows top to bottom', () => {
    const text = itemsToText([
      item('450.00', 400, 700, 30),
      item('01/10/26', 10, 700, 40),
      item('UPI-SWIGGY', 60, 700, 50),
      item('02/10/26', 10, 688, 40),
      item('SALARY', 60, 688, 30),
      item('25,000.00', 390, 688, 45),
      item('Statement', 10, 760, 45),
    ]);
    expect(text).toBe(
      ['Statement', '01/10/26 UPI-SWIGGY 450.00', '02/10/26 SALARY 25,000.00'].join('\n'),
    );
  });

  it('does not add a space inside a word split into runs, and drops empty end-of-line runs', () => {
    expect(itemsToText([item('UP', 10, 5, 10), item('I', 20, 5, 5), item('', 25, 5, 0, 0)])).toBe(
      'UPI',
    );
  });

  it('tolerates a small baseline wobble within a row', () => {
    expect(itemsToText([item('A', 10, 100.4), item('B', 40, 100), item('C', 10, 80)])).toBe(
      'A B\nC',
    );
  });

  it('feeds the statement text parser the line it was written for', () => {
    const text = itemsToText([
      item('Opening Balance 54,771.50', 10, 740, 120),
      item('Date', 10, 720),
      item('Narration', 60, 720),
      item('Withdrawal', 300, 720),
      item('Balance', 400, 720),
      item('01/10/26', 10, 700, 40),
      item('UPI-SWIGGY-SWIGGY@ICICI-ICIC0000001-627412345678', 60, 700, 220),
      item('450.00', 300, 700, 30),
      item('54,321.50', 400, 700, 45),
    ]);
    const parsed = parseStatementText([text], { today: '2026-10-17', order: 'dmy' });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.date).toBe('2026-10-01');
    expect(parsed.rows[0]!.amount).toBe('45000');
  });
});

// -- the session ----------------------------------------------------------------

/** A stand-in for the page: records what it was sent and answers like the real one. */
function fakePage(options: {
  pages: readonly PdfTextItem[][];
  password?: string;
  manyPages?: number;
}) {
  const sent: ToPage[] = [];
  let session: PdfReadSession | null = null;
  const reply = (message: object): void => {
    queueMicrotask(() => session?.handle(JSON.stringify(message)));
  };
  let locked = options.password !== undefined;
  const send = (message: ToPage): void => {
    sent.push(message);
    if (message.t === 'open') {
      if (locked && !message.password) reply({ t: 'error', name: 'PasswordException', code: 1 });
      else if (locked && message.password !== options.password) {
        reply({ t: 'error', name: 'PasswordException', code: 2 });
      } else reply({ t: 'opened', pages: options.manyPages ?? options.pages.length });
    } else if (message.t === 'password') {
      if (message.password === options.password) {
        locked = false;
        reply({ t: 'opened', pages: options.pages.length });
      } else reply({ t: 'error', name: 'PasswordException', code: 2 });
    } else if (message.t === 'page') {
      reply({ t: 'items', n: message.n, items: options.pages[message.n - 1] ?? [] });
    } else if (message.t === 'render') {
      reply({ t: 'image', n: message.n, base64: `IMG${message.n}` });
    }
  };
  return {
    sent,
    attach(next: PdfReadSession) {
      session = next;
    },
    send,
  };
}

const bytes = new TextEncoder().encode('%PDF-1.7 hello');
const textPage = [item('01/10/26 UPI-SWIGGY 450.00 54,321.50 and more text here', 5, 700, 300)];

function sessionFor(page: ReturnType<typeof fakePage>, extra: object = {}) {
  const session = new PdfReadSession({ send: page.send, ...extra });
  page.attach(session);
  return session;
}

describe('PdfReadSession', () => {
  it('sends the bytes once the page is ready, then reads every page in order', async () => {
    const page = fakePage({ pages: [textPage, textPage] });
    const session = sessionFor(page);
    const done = session.start(bytes);
    expect(page.sent).toEqual([]);
    session.handle('{"t":"ready"}');
    const result = await done;
    expect(result).toEqual({
      ok: true,
      pages: [
        { kind: 'text', text: '01/10/26 UPI-SWIGGY 450.00 54,321.50 and more text here' },
        { kind: 'text', text: '01/10/26 UPI-SWIGGY 450.00 54,321.50 and more text here' },
      ],
    });
    expect(page.sent.map((m) => m.t)).toEqual(['begin', 'chunk', 'open', 'page', 'page', 'close']);
    const chunk = page.sent.find((m) => m.t === 'chunk');
    expect(chunk && 'data' in chunk && Buffer.from(chunk.data, 'base64')).toEqual(
      Buffer.from(bytes),
    );
  });

  it('also works when the page was ready before start', async () => {
    const page = fakePage({ pages: [textPage] });
    const session = sessionFor(page);
    session.handle('{"t":"ready"}');
    expect(await session.start(bytes)).toMatchObject({ ok: true });
  });

  it('renders a page with no text layer as an image and keeps the order', async () => {
    const page = fakePage({ pages: [textPage, [], textPage] });
    const session = sessionFor(page);
    const done = session.start(bytes);
    session.handle('{"t":"ready"}');
    const result = await done;
    expect(result.ok && result.pages.map((p) => p.kind)).toEqual(['text', 'image', 'text']);
    expect(result.ok && result.pages[1]).toEqual({
      kind: 'image',
      base64: 'IMG2',
      mimeType: 'image/jpeg',
    });
    expect(page.sent.filter((m) => m.t === 'render')).toEqual([
      { t: 'render', n: 2, maxWidth: 1400 },
    ]);
  });

  it('refuses a PDF over the page cap without reading any page', async () => {
    const page = fakePage({ pages: [textPage], manyPages: 61 });
    const session = sessionFor(page);
    const done = session.start(bytes);
    session.handle('{"t":"ready"}');
    expect(await done).toEqual({ ok: false, reason: 'too_many_pages' });
    expect(page.sent.some((m) => m.t === 'page')).toBe(false);
    expect(page.sent.at(-1)).toEqual({ t: 'close' });
  });

  it('asks for a password, says when it was wrong, and opens with the right one without re-sending bytes', async () => {
    const page = fakePage({ pages: [textPage], password: 'dob1990' });
    const session = sessionFor(page);
    const first = session.start(bytes);
    session.handle('{"t":"ready"}');
    expect(await first).toEqual({ ok: false, reason: 'password_needed' });
    expect(await session.retry('nope')).toEqual({ ok: false, reason: 'wrong_password' });
    const result = await session.retry('dob1990');
    expect(result).toMatchObject({ ok: true });
    expect(page.sent.filter((m) => m.t === 'chunk')).toHaveLength(1);
    expect(page.sent.filter((m) => m.t === 'begin')).toHaveLength(1);
  });

  it('never keeps the password: it is only ever in the message that carries it', async () => {
    const page = fakePage({ pages: [textPage], password: 'dob1990' });
    const session = sessionFor(page);
    const first = session.start(bytes);
    session.handle('{"t":"ready"}');
    await first;
    await session.retry('dob1990');
    expect(JSON.stringify(session)).not.toContain('dob1990');
    expect(JSON.stringify(Object.entries(session))).not.toContain('dob1990');
  });

  it('can be opened with a password given up front', async () => {
    const page = fakePage({ pages: [textPage], password: 'dob1990' });
    const session = sessionFor(page);
    const done = session.start(bytes, 'dob1990');
    session.handle('{"t":"ready"}');
    expect(await done).toMatchObject({ ok: true });
  });

  it('maps a broken file to unreadable', async () => {
    const session = new PdfReadSession({ send: () => {} });
    const done = session.start(bytes);
    session.handle('{"t":"ready"}');
    session.handle('{"t":"error","name":"InvalidPDFException","code":null}');
    expect(await done).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('ignores messages it cannot place', async () => {
    const page = fakePage({ pages: [textPage] });
    const session = sessionFor(page);
    const done = session.start(bytes);
    session.handle('garbage');
    session.handle('{"t":"items","n":7,"items":[]}');
    session.handle('{"t":"ready"}');
    expect(await done).toMatchObject({ ok: true });
  });

  it('cancel settles a pending read and closes the page', async () => {
    const page = fakePage({ pages: [textPage] });
    const session = sessionFor(page);
    const done = session.start(bytes);
    session.cancel();
    expect(await done).toEqual({ ok: false, reason: 'unreadable' });
    expect(page.sent.at(-1)).toEqual({ t: 'close' });
  });

  describe('timeouts', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('gives up when the page never answers', async () => {
      const sent: ToPage[] = [];
      const session = new PdfReadSession({ send: (m) => sent.push(m), stepTimeoutMs: 1000 });
      const done = session.start(bytes);
      session.handle('{"t":"ready"}');
      await vi.advanceTimersByTimeAsync(1001);
      expect(await done).toEqual({ ok: false, reason: 'unreadable' });
      expect(sent.at(-1)).toEqual({ t: 'close' });
    });

    it('does not run the clocks while waiting for a person to type a password', async () => {
      const page = fakePage({ pages: [textPage], password: 'x1' });
      const session = sessionFor(page, { stepTimeoutMs: 1000, totalTimeoutMs: 5000 });
      const first = session.start(bytes);
      session.handle('{"t":"ready"}');
      await vi.advanceTimersByTimeAsync(0);
      expect(await first).toEqual({ ok: false, reason: 'password_needed' });
      await vi.advanceTimersByTimeAsync(60_000);
      const second = session.retry('x1');
      await vi.advanceTimersByTimeAsync(0);
      expect(await second).toMatchObject({ ok: true });
    });

    it('stops a read that goes on too long overall', async () => {
      const session = new PdfReadSession({
        send: () => {},
        stepTimeoutMs: 10_000,
        totalTimeoutMs: 2000,
      });
      const done = session.start(bytes);
      await vi.advanceTimersByTimeAsync(2001);
      expect(await done).toEqual({ ok: false, reason: 'unreadable' });
    });
  });
});

describe('the bundled reader page', () => {
  it('is up to date with pdfjs-dist and the glue script (run build-pdf-reader.mjs to refresh)', () => {
    expect(readFileSync(OUTPUT as string, 'utf8')).toBe(buildModule() as string);
  });

  it('is self-contained: it loads nothing', () => {
    const html = (buildModule() as string).toLowerCase();
    expect(html).not.toMatch(/<script[^>]*\ssrc=/);
    expect(html).not.toMatch(/<link[^>]*href=/);
    expect(html).not.toContain('import.meta');
  });
});
