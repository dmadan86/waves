import { describe, expect, it } from 'vitest';
import { expenseCaption } from '../src/lib/expenseCaption';

const t = {
  youOwe: 'You owe',
  youGet: 'You get',
  settledShort: 'Settled',
  notInSplit: 'Not in split',
};

describe('expenseCaption', () => {
  it('maps borrowed to the owe pill', () => {
    expect(expenseCaption(-250n, t)).toEqual({ kind: 'owe', label: 'You owe' });
  });
  it('maps lent to the get pill', () => {
    expect(expenseCaption(250n, t)).toEqual({ kind: 'get', label: 'You get' });
  });
  it('keeps settled and not-involved neutral', () => {
    expect(expenseCaption(0n, t)).toEqual({ kind: 'neutral', label: 'Settled' });
    expect(expenseCaption(null, t)).toEqual({ kind: 'neutral', label: 'Not in split' });
  });
});
