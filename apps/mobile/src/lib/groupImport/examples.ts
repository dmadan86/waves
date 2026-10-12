/**
 * The three sample files the "CSV examples" sheet shows.
 *
 * Kept as real text rather than prose: what the sheet previews is exactly what
 * "Copy example" puts on the clipboard, and `groupImport.test.ts` reads every
 * one back through the same pipeline a picked file takes, so an example can
 * never describe a layout the reader does not accept.
 */

export type ExampleId = 'simple' | 'split' | 'splitwise';

export const EXAMPLE_IDS: readonly ExampleId[] = ['simple', 'split', 'splitwise'];

export const EXAMPLES: Readonly<Record<ExampleId, string>> = {
  simple: [
    'Date,Description,Amount,Paid by',
    '2026-10-01,Groceries,1200,Asha',
    '2026-10-02,Cab to airport,640.50,Ravi',
  ].join('\n'),
  split: [
    'Date,Description,Amount,Currency,Paid by,Split between,Category',
    '01/10/2026,Dinner at Toit,"3,450",INR,Asha,"Asha; Ravi; Meera",Food',
    '02/10/2026,Hotel,9000,INR,Ravi,"Asha:2; Ravi:1",Stay',
  ].join('\n'),
  // Each person's column is their net for the row: up (+) or down (-).
  splitwise: [
    'Date,Description,Category,Cost,Currency,Asha,Ravi,Meera',
    '2026-10-01,Dinner at Toit,Dining out,3450.00,INR,2300.00,-1150.00,-1150.00',
    '2026-10-02,Hotel,Hotel,9000.00,INR,-3000.00,6000.00,-3000.00',
  ].join('\n'),
};
