/**
 * One currency picker, everywhere.
 *
 * "Choose currency" was redesigned (search, recent cards, flag rows) and then
 * only one screen used it: the group expense form, the quick expense sheet,
 * the group's "Settles in" row and the trip-rate sheet each drew their own list
 * of the same currencies — chips, symbols, plain rows. Every one of them now
 * goes through `components/expense/CurrencySheet` (the sheet, or its
 * `CurrencyChoices` body inside a sheet that is already open). A screen drawing
 * the offered currencies itself again has forked the picker.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the currency picker', () => {
  it('is drawn by CurrencySheet alone', () => {
    const drawing = sources(SRC)
      .filter((file) => /COMMON_CURRENCIES\.map\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(drawing).toEqual([]);
  });

  it('is used by every screen that asks for a currency', () => {
    for (const file of [
      'app/capture.tsx',
      'app/group/[id]/add-expense.tsx',
      'components/QuickExpenseSheet.tsx',
      'components/TripRates.tsx',
    ]) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).toMatch(
        /from '@\/components\/expense\/CurrencySheet'/,
      );
    }
  });
});
