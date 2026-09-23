/**
 * Import and receipt-check problems reach the screen in the reader's language.
 *
 * Core hands back a kind and an English sentence; the screens used to show the
 * sentence. These pin that every kind has its own translated line, that the
 * row/file prefix comes from the strings, and that `message` never leaks.
 */

import { describe, expect, it, vi } from 'vitest';

import { ImportProblemKind, type ImportProblem, type ReceiptProblem } from '@waves/core';

import { Language, STRINGS_BY_LANGUAGE } from '@/i18n';
import { importProblemLine, importProblemText, receiptProblemText } from '../src/lib/problemText';

// The i18n module imports expo-localization (and through it react-native) at
// load; only the strings are needed here.
vi.mock('expo-localization', () => ({ getLocales: () => [] }));

const en = STRINGS_BY_LANGUAGE[Language.En];
const LEAK = 'ENGLISH SENTENCE FROM CORE';

const importProblem = (kind: ImportProblemKind, row: number | null = 3): ImportProblem => ({
  kind,
  row,
  message: LEAK,
});

describe('importProblemText', () => {
  it('gives every kind its own translated sentence and never the core message', () => {
    const kinds = Object.values(ImportProblemKind);
    const texts = kinds.map((kind) => importProblemText(importProblem(kind), en.importLedger));
    for (const text of texts) {
      expect(text).toBeTruthy();
      expect(text).not.toContain(LEAK);
    }
    expect(new Set(texts).size).toBe(kinds.length);
  });

  it('maps a kind to the matching key', () => {
    expect(importProblemText(importProblem(ImportProblemKind.NewerFormat), en.importLedger)).toBe(
      en.importLedger.problemNewerFormat,
    );
    expect(
      importProblemText(importProblem(ImportProblemKind.RowDoesNotBalance), en.importLedger),
    ).toBe(en.importLedger.problemDoesNotBalance);
  });

  it('reads from the chosen language', () => {
    const ta = STRINGS_BY_LANGUAGE[Language.Ta].importLedger;
    const tagged = { ...ta, problemNoRows: 'TA no rows' };
    expect(importProblemText(importProblem(ImportProblemKind.NoRows), tagged)).toBe('TA no rows');
  });
});

describe('importProblemLine', () => {
  it('prefixes a row problem with its row number', () => {
    expect(
      importProblemLine(importProblem(ImportProblemKind.NonPositiveCost, 7), en.importLedger),
    ).toBe(`Row 7 · ${en.importLedger.problemNonPositiveCost}`);
  });

  it('prefixes a file-wide problem with the file label', () => {
    expect(importProblemLine(importProblem(ImportProblemKind.NoRows, null), en.importLedger)).toBe(
      `File · ${en.importLedger.problemNoRows}`,
    );
  });
});

describe('receiptProblemText', () => {
  const receiptProblem = (kind: ReceiptProblem['kind'], itemIndex?: number): ReceiptProblem => ({
    kind,
    itemIndex,
    message: LEAK,
  });

  it('names the line a line problem is about', () => {
    expect(
      receiptProblemText(receiptProblem('low_confidence', 1), en.itemize, ['Tea', 'Dosa']),
    ).toBe('“Dosa” was hard to read — check the name and amount.');
    expect(receiptProblemText(receiptProblem('negative_line', 0), en.itemize, ['Offer'])).toContain(
      '“Offer”',
    );
  });

  it('falls back to "Item n" when the line has no readable name', () => {
    expect(
      receiptProblemText(receiptProblem('low_confidence', 2), en.itemize, ['a', 'b', '  ']),
    ).toContain('“Item 3”');
  });

  it('translates the whole-receipt problems and never shows the core message', () => {
    for (const kind of ['no_items', 'does_not_reconcile'] as const) {
      const text = receiptProblemText(receiptProblem(kind), en.itemize, []);
      expect(text).toBeTruthy();
      expect(text).not.toContain(LEAK);
    }
    expect(receiptProblemText(receiptProblem('does_not_reconcile'), en.itemize, [])).toBe(
      en.itemize.problemDoesNotReconcile,
    );
  });
});
