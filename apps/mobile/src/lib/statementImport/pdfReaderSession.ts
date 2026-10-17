/**
 * One PDF, read through the page-side reader. No React and no WebView in here:
 * it is given a `send` and is fed what the page says, so the whole conversation
 * (open, ask for a password, read page by page, render the scans, time out) is a
 * unit test.
 *
 * The bytes are sent once and stay inside the page, so a wrong password is
 * retried with `retry(password)` and nothing is re-sent. The password is passed
 * straight through in a message; this class never holds it.
 */

import { STATEMENT_MAX_PAGES } from '@waves/core';

import {
  PDF_SCAN_WIDTH_PX,
  PDF_STEP_TIMEOUT_MS,
  PDF_TOTAL_TIMEOUT_MS,
  type PdfPageRead,
  type PdfReadResult,
} from './pdfReader';
import {
  bytesToBase64,
  chunkBase64,
  isScannedPage,
  itemsToText,
  mapPdfError,
  parseFromPage,
  type ToPage,
} from './pdfReaderProtocol';

export interface PdfSessionOptions {
  readonly send: (message: ToPage) => void;
  readonly maxPages?: number;
  readonly stepTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
}

type Phase = 'loading' | 'opening' | 'reading' | 'rendering' | 'locked' | 'done';

export class PdfReadSession {
  private readonly send: (message: ToPage) => void;
  private readonly maxPages: number;
  private readonly stepMs: number;
  private readonly totalMs: number;

  private phase: Phase = 'loading';
  private ready = false;
  private started: { bytes: Uint8Array; password?: string } | null = null;
  private resolve: ((result: PdfReadResult) => void) | null = null;
  private pageCount = 0;
  private next = 1;
  private pages: PdfPageRead[] = [];
  private stepTimer: ReturnType<typeof setTimeout> | null = null;
  private totalTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: PdfSessionOptions) {
    this.send = options.send;
    this.maxPages = options.maxPages ?? STATEMENT_MAX_PAGES;
    this.stepMs = options.stepTimeoutMs ?? PDF_STEP_TIMEOUT_MS;
    this.totalMs = options.totalTimeoutMs ?? PDF_TOTAL_TIMEOUT_MS;
  }

  /** Begin reading. Resolves with the pages, or the reason it could not. */
  start(bytes: Uint8Array, password?: string): Promise<PdfReadResult> {
    this.started = { bytes, ...(password ? { password } : {}) };
    this.armTotal();
    this.armStep();
    const promise = this.wait();
    if (this.ready) this.begin();
    return promise;
  }

  /** After `password_needed` or `wrong_password`: try again with what the person typed. */
  retry(password: string): Promise<PdfReadResult> {
    if (this.phase !== 'locked') return Promise.resolve({ ok: false, reason: 'unreadable' });
    this.phase = 'opening';
    this.armTotal();
    this.armStep();
    const promise = this.wait();
    this.send({ t: 'password', password });
    return promise;
  }

  /** The person gave up, or the screen went away. */
  cancel(): void {
    if (this.phase === 'done') return;
    this.finish({ ok: false, reason: 'unreadable' });
  }

  /** Feed one raw message from the page. Anything unrecognised is ignored. */
  handle(raw: string): void {
    if (this.phase === 'done') return;
    const message = parseFromPage(raw);
    if (!message) return;

    switch (message.t) {
      case 'ready':
        this.ready = true;
        if (this.started && this.phase === 'loading') this.begin();
        return;
      case 'error': {
        const reason = mapPdfError(message.name, message.code);
        if (reason === 'password_needed' || reason === 'wrong_password') {
          // Waiting on a person is not a stall: both clocks stop until they answer.
          this.phase = 'locked';
          this.clearStep();
          this.clearTotal();
          this.settle({ ok: false, reason });
          return;
        }
        this.finish({ ok: false, reason: 'unreadable' });
        return;
      }
      case 'opened':
        if (this.phase !== 'opening') return;
        if (message.pages === 0) return this.finish({ ok: false, reason: 'unreadable' });
        if (message.pages > this.maxPages) {
          return this.finish({ ok: false, reason: 'too_many_pages' });
        }
        this.pageCount = message.pages;
        this.next = 1;
        this.pages = [];
        this.askPage();
        return;
      case 'items':
        if (this.phase !== 'reading' || message.n !== this.next) return;
        if (isScannedPage(message.items)) {
          this.phase = 'rendering';
          this.armStep();
          this.send({ t: 'render', n: this.next, maxWidth: PDF_SCAN_WIDTH_PX });
          return;
        }
        this.pages.push({ kind: 'text', text: itemsToText(message.items) });
        this.advance();
        return;
      case 'image':
        if (this.phase !== 'rendering' || message.n !== this.next) return;
        this.pages.push({ kind: 'image', base64: message.base64, mimeType: 'image/jpeg' });
        this.advance();
        return;
    }
  }

  // -- internals --------------------------------------------------------------

  private begin(): void {
    const started = this.started;
    if (!started) return;
    // The bytes and password are handed on and dropped from this object.
    this.started = null;
    this.phase = 'opening';
    this.send({ t: 'begin' });
    for (const data of chunkBase64(bytesToBase64(started.bytes))) this.send({ t: 'chunk', data });
    this.send({ t: 'open', ...(started.password ? { password: started.password } : {}) });
  }

  private askPage(): void {
    this.phase = 'reading';
    this.armStep();
    this.send({ t: 'page', n: this.next });
  }

  private advance(): void {
    if (this.next >= this.pageCount) {
      this.finish({ ok: true, pages: this.pages });
      return;
    }
    this.next += 1;
    this.askPage();
  }

  private wait(): Promise<PdfReadResult> {
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private settle(result: PdfReadResult): void {
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.(result);
  }

  private finish(result: PdfReadResult): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.started = null;
    this.pages = [];
    this.clearStep();
    this.clearTotal();
    try {
      this.send({ t: 'close' });
    } catch {
      // The page may already be gone.
    }
    this.settle(result);
  }

  private armStep(): void {
    this.clearStep();
    this.stepTimer = setTimeout(
      () => this.finish({ ok: false, reason: 'unreadable' }),
      this.stepMs,
    );
  }

  private armTotal(): void {
    this.clearTotal();
    this.totalTimer = setTimeout(
      () => this.finish({ ok: false, reason: 'unreadable' }),
      this.totalMs,
    );
  }

  private clearTotal(): void {
    if (this.totalTimer) clearTimeout(this.totalTimer);
    this.totalTimer = null;
  }

  private clearStep(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.stepTimer = null;
  }
}
