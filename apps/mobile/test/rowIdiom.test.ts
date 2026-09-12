/**
 * One row states a fact; a different row opens a door. This is the guard on
 * the first half of that split.
 *
 * `DetailRow` (`src/components/DetailRows.tsx`) used to have two rivals drawn
 * the same job the other way up: `SettingRow` and `FieldRow`, both in
 * `src/components/expense/SheetOverlay.tsx`. A bill's date read one way on the
 * expense screen and a different way on the form that filed it, because the
 * two idioms had never been reconciled. They now have been — every screen that
 * states a short, already-chosen answer (date, category, payment rail,
 * currency, income source, a loan's start date) goes through `DetailRow`, and
 * `SettingRow`/`FieldRow` are gone.
 *
 * This reads the call sites as source rather than rendering them: the
 * components this exercises pull in `react-native`, Reanimated and gesture
 * handler, none of which this node-environment suite can mount, and the thing
 * worth protecting — which row a screen imports — is legible in the text
 * without any of that. A screen that quietly went back to hand-rolling its own
 * date box would still compile and render; it would just look like a
 * different app again, which is exactly the regression this test exists to
 * catch.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../src');
const source = (relativePath: string): string => readFileSync(join(SRC, relativePath), 'utf8');

// Every screen and shared row component this conversion touched: the ones
// that used to import `SettingRow` or `FieldRow` from `SheetOverlay`, and now
// import `DetailRow` from `DetailRows` instead.
const CONVERTED = [
  'app/capture.tsx',
  'app/group/[id]/add-expense.tsx',
  'app/personal/entry.tsx',
  'app/personal/loans.tsx',
  'components/Category.tsx',
  'components/PaymentMethodPicker.tsx',
  'components/IncomeSource.tsx',
];

describe('a filed fact reads the same way everywhere it is stated', () => {
  it('imports DetailRow rather than hand-rolling the row', () => {
    for (const file of CONVERTED) {
      const text = source(file);
      expect(text, `${file} should import DetailRow`).toMatch(
        /import\s*\{[^}]*\bDetailRow\b[^}]*\}\s*from\s*'@\/components\/DetailRows'/,
      );
    }
  });

  it('no longer reaches for the rows DetailRow replaced', () => {
    for (const file of CONVERTED) {
      const text = source(file);
      expect(text, `${file} should not import SettingRow`).not.toMatch(/\bSettingRow\b/);
      expect(text, `${file} should not import FieldRow`).not.toMatch(/\bFieldRow\b/);
    }
  });

  it('SheetOverlay no longer defines the rows it handed off', () => {
    const text = source('components/expense/SheetOverlay.tsx');
    expect(text).not.toMatch(/export function SettingRow/);
    expect(text).not.toMatch(/export function FieldRow/);
    // What is left: the sheet itself, and the option row a sheet's choices are
    // listed in — a different job (see DetailRows.tsx's header).
    expect(text).toMatch(/export function SheetOverlay/);
    expect(text).toMatch(/export function ChoiceRow/);
  });

  it('the loan editor names its date field, which the box it replaced did not', () => {
    const text = source('app/personal/loans.tsx');
    // The row this became carries an accessible label by construction
    // (DetailRow's own accessibilityLabel default); this pins the visible
    // label so a screen reader is not left with the bare date on its own.
    expect(text).toMatch(/label=\{t\.personal\.startsOn\}/);
  });
});
