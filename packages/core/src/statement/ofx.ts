/**
 * OFX and QFX statements (the export most US, UK and Australian banks and
 * Quicken-style tools offer), read without a model.
 *
 * Version 1 is SGML (leaf tags are not closed) and version 2 is XML; both are
 * handled by reading leaf values as "text up to the next tag", which is all the
 * transaction block needs. Amounts are read digit by digit (ADR-003). The bank's
 * own transaction id (FITID) is the row's reference, so importing the same file
 * twice, or the same period from two files, dedupes.
 *
 * An OFX transaction list carries no per-row running balance, so the balance
 * check has nothing to compare and these rows are not flagged by it.
 */

import { parseLooseAmount } from '../import/amount';
import { isCurrencyCode, type CurrencyCode } from '../money/currency';
import { normaliseRef } from './narration';
import type { StatementRow } from './types';

export type OfxParseResult =
  | {
      readonly ok: true;
      readonly rows: StatementRow[];
      /** CURDEF, defaulting to the caller's fallback when the file names none. */
      readonly currency: string;
      /** Ledger balance at the statement's end, signed minor units, when given. */
      readonly closingBalance: string | null;
      readonly skipped: number;
    }
  | { readonly ok: false; readonly reason: 'not_ofx' | 'no_transactions' };

/** True for an OFX / QFX file, judged by its content rather than its name. */
export function looksLikeOfx(text: string): boolean {
  const head = text.slice(0, 4096);
  return /OFXHEADER\s*:/i.test(head) || /<OFX[\s>]/i.test(head);
}

/** The text after the first `marker`, up to the next tag or line break. Scanned, not backtracked. */
function textAfter(block: string, marker: RegExp): string {
  const found = marker.exec(block);
  if (!found) return '';
  const rest = block.slice(found.index + found[0].length).trimStart();
  // `<NAME><![CDATA[EFTPOS WDL ALDI  ]]></NAME>`: the text is whatever the section wraps.
  if (rest.startsWith('<![CDATA[')) {
    const close = rest.indexOf(']]>');
    return (close < 0 ? rest.slice(9) : rest.slice(9, close)).trim();
  }
  const end = rest.search(/[<\r\n]/);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/** Each `<STMTTRN>` block, ended by its close tag, the next block, or the end of the list. */
function transactionBlocks(text: string): string[] {
  const open = /<STMTTRN>/gi;
  const stop = /<\/STMTTRN>|<\/BANKTRANLIST>|<STMTTRN>/gi;
  const blocks: string[] = [];
  let start: RegExpExecArray | null;
  while ((start = open.exec(text)) !== null) {
    stop.lastIndex = start.index + start[0].length;
    const found = stop.exec(text);
    if (!found) break;
    const end =
      found[0].toUpperCase() === '</STMTTRN>' ? found.index + found[0].length : found.index;
    blocks.push(text.slice(start.index, end));
    open.lastIndex = end;
  }
  return blocks;
}

function leaf(block: string, tag: string): string | null {
  const value = textAfter(block, new RegExp(`<${tag}>`, 'i'));
  return value ? decodeEntities(value) : null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/** `20261001`, `20261001120000`, `20261001120000.000[-5:EST]` to `2026-10-01`. */
function ofxDate(value: string | null): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseOfx(text: string, fallbackCurrency: CurrencyCode = 'USD'): OfxParseResult {
  if (!looksLikeOfx(text)) return { ok: false, reason: 'not_ofx' };

  const declared = leaf(text, 'CURDEF')?.toUpperCase() ?? null;
  const currency: CurrencyCode = declared && isCurrencyCode(declared) ? declared : fallbackCurrency;

  const rows: StatementRow[] = [];
  let skipped = 0;
  for (const block of transactionBlocks(text)) {
    const date = ofxDate(leaf(block, 'DTPOSTED'));
    const parsed = parseLooseAmount(leaf(block, 'TRNAMT') ?? '', currency, 'dot');
    if (!date || !parsed.ok) {
      skipped += 1;
      continue;
    }
    const name = leaf(block, 'NAME');
    const memo = leaf(block, 'MEMO');
    const description =
      [name, memo && memo !== name ? memo : null].filter(Boolean).join(' ').replace(/\s+/g, ' ') ||
      'Transaction';
    const fitid = leaf(block, 'FITID');
    const check = leaf(block, 'CHECKNUM');
    const magnitude = parsed.minor < 0n ? -parsed.minor : parsed.minor;
    // A bank's own id, made unique: a short counter ("1", "2") is only unique within one statement.
    const id = normaliseRef(fitid ?? check ?? '');
    const ref = id === '' ? null : id.length >= 8 ? id : `${date.replace(/-/g, '')}${id}`;
    rows.push({
      index: rows.length,
      date,
      description,
      amount: magnitude.toString(),
      direction: parsed.minor < 0n ? 'debit' : 'credit',
      ref,
      balance: null,
      confidence: 0.95,
      warnings: magnitude === 0n ? ['zero_amount'] : [],
    });
  }
  if (rows.length === 0) return { ok: false, reason: 'no_transactions' };

  const ledgerAt = text.search(/<LEDGERBAL>/i);
  const ledger = ledgerAt < 0 ? '' : textAfter(text.slice(ledgerAt), /<BALAMT>/i);
  const closing = parseLooseAmount(ledger, currency, 'dot');
  return {
    ok: true,
    rows,
    currency,
    closingBalance: closing.ok ? closing.minor.toString() : null,
    skipped,
  };
}
