/**
 * Capture used to ask "what for" and "paid with" as two lanes of chips, sitting
 * between the description and a separate card that held only the destination
 * and the date — three different controls for four facts that read as one
 * question on the group expense form. This is the guard on folding all four
 * into the one card add-expense already wears, and on the receipt moving up to
 * where add-expense reads a bill: right under the amount, ahead of the fields
 * scanning it fills in.
 *
 * Source-reading, like `rowIdiom.test.ts` this extends: the screen pulls in
 * Reanimated and gesture-handler by way of `SheetOverlay`, neither of which
 * this node-environment suite can mount, and what is worth protecting — which
 * components a screen reaches for, and in what order it lays them out — is
 * legible in the text without any of that.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../src');
const source = (relativePath: string): string => readFileSync(join(SRC, relativePath), 'utf8');

describe('capture folds what-for, paid-with, group and date into one card', () => {
  const capture = source('app/capture.tsx');

  it('reaches for the same row + sheet pair add-expense uses for category', () => {
    expect(capture).toMatch(
      /import\s*\{\s*CategoryRow,\s*CategorySheet\s*\}\s*from\s*'@\/components\/Category'/,
    );
    // The chip lane this replaced — never both at once, or the guess-follows-
    // typing logic would be feeding two controls that disagree.
    expect(capture).not.toMatch(/\bCategoryPicker\b/);
  });

  it('reaches for the same row + sheet pair add-expense uses for payment', () => {
    expect(capture).toMatch(
      /import\s*\{\s*PaymentMethodRow,\s*PaymentMethodSheet\s*\}\s*from\s*'@\/components\/PaymentMethodPicker'/,
    );
    // The bare chip component this replaced. A bare word-boundary check would
    // also flag the import line itself, so this only fails once the chip
    // component is reintroduced as a call (JSX or a value reference), not as
    // part of the row/sheet identifiers above.
    expect(capture).not.toMatch(/<PaymentMethodPicker[\s/>]/);
    expect(capture).not.toMatch(/[^.]PaymentMethodPicker\(/);
  });

  it('lists what-for, paid-with, the destination and the date in one DetailRows block', () => {
    const match = capture.match(/<DetailRows>([\s\S]*?)<\/DetailRows>/);
    expect(match, 'capture should render exactly one DetailRows block').not.toBeNull();
    const block = match![1]!;
    expect(block).toMatch(/<CategoryRow/);
    expect(block).toMatch(/<PaymentMethodRow/);
    expect(block).toMatch(/label=\{t\.captures\.group\}/);
    expect(block).toMatch(/label=\{t\.captures\.date\}/);
  });

  it('never scatters the four facts as chip lanes or stray View labels again', () => {
    // The two headings a bare `<Text>{t.captures.category}</Text>` /
    // `{t.captures.paidWith}</Text>` used to sit atop before each field became
    // a labelled row inside the card — DetailRow now carries the label, so a
    // sibling heading for either would be the fold coming undone.
    expect(capture).not.toMatch(/\{t\.captures\.category\}\s*<\/Text>/);
  });

  it('reads the bill before the fields scanning it fills in, the order add-expense uses', () => {
    const receiptAt = capture.indexOf('t.captures.receipt');
    const descriptionAt = capture.indexOf('<DescriptionField');
    const factsCardAt = capture.indexOf('<DetailRows>');
    expect(receiptAt).toBeGreaterThan(-1);
    expect(descriptionAt).toBeGreaterThan(-1);
    expect(factsCardAt).toBeGreaterThan(-1);
    expect(receiptAt).toBeLessThan(descriptionAt);
    expect(descriptionAt).toBeLessThan(factsCardAt);
  });

  it("keeps paid-with's not-said answer reachable from the sheet, not only the old chip lane", () => {
    expect(capture).toMatch(/<PaymentMethodSheet[\s\S]*?allowDeselect[\s\S]*?\/>/);
  });
});

describe('PaymentMethodRow carries the null "not said" state the chip lane used to', () => {
  const picker = source('components/PaymentMethodPicker.tsx');

  it('PaymentMethodRow accepts a null value', () => {
    const match = picker.match(/export function PaymentMethodRow\(\{[\s\S]*?\n\}\)/);
    expect(match, 'PaymentMethodRow should still be exported').not.toBeNull();
    expect(match![0]).toMatch(/value:\s*PaymentMethod\s*\|\s*null/);
  });

  it('draws a real placeholder answer rather than a blank when nothing is said', () => {
    expect(picker).toMatch(/t\.captures\.paidNotSaid/);
  });

  it('the standalone chip component is gone now that no screen renders it', () => {
    expect(picker).not.toMatch(/export function PaymentMethodPicker/);
  });

  it('PaymentMethodSheet still supports allowDeselect for the caller that needs it', () => {
    expect(picker).toMatch(/allowDeselect/);
  });
});
