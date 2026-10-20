import { describe, expect, it } from 'vitest';
import { expenseCaption } from '../src/lib/expenseCaption';

const t = {
  pillBorrowed: 'Borrowed',
  pillLent: 'Lent',
  settledShort: 'Settled',
  notInSplit: 'Not in split',
};

describe('expenseCaption', () => {
  it('maps borrowed to the red pill', () => {
    expect(expenseCaption(-250n, t)).toEqual({ kind: 'owe', label: 'Borrowed' });
  });
  it('maps lent to the blue pill', () => {
    expect(expenseCaption(250n, t)).toEqual({ kind: 'get', label: 'Lent' });
  });
  it('keeps settled and not-involved neutral', () => {
    expect(expenseCaption(0n, t)).toEqual({ kind: 'neutral', label: 'Settled' });
    expect(expenseCaption(null, t)).toEqual({ kind: 'neutral', label: 'Not in split' });
  });
});
