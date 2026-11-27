import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The owner wants Add expense and Receipts as icons in the property page's top bar,
// not as buttons under it.
const src = readFileSync(join(__dirname, '../src/app/rentals/[id].tsx'), 'utf8');
const header = src.slice(
  src.indexOf('<PlainHeader\n        title={prop.name}'),
  src.indexOf('<DetailEnter>'),
);

describe('rental property page header actions', () => {
  it('puts Add expense and Receipts in the header as icons', () => {
    expect(header).toMatch(/<IconButton label=\{w\.addExpense\}/);
    expect(header).toMatch(/<IconButton label=\{w\.receiptsBtn\}/);
  });
  it('no longer shows them as a button row below the header', () => {
    expect(src).not.toMatch(/<TintButton\s+label=\{w\.addExpense\}/);
    expect(src).not.toMatch(/<TintButton\s+label=\{w\.receiptsBtn\}/);
  });
});
