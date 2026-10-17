import { readFileSync } from 'node:fs';

import { decodeBytes, readTable } from '../../src';

/** A synthetic statement from `test/fixtures/statement/` (no real account, name or number). */
export const statementText = (name: string): string =>
  decodeBytes(
    new Uint8Array(readFileSync(new URL(`../fixtures/statement/${name}`, import.meta.url))),
  ).text;

export const statementTable = (name: string) => readTable(statementText(name));

/**
 * What every fixture says, whatever the bank: the same eight transactions from
 * 1 to 9 October 2026, opening balance 50,000.00. [direction, amount, balance].
 */
export const EXPECTED: readonly (readonly ['debit' | 'credit', string, string])[] = [
  ['debit', '45000', '4955000'],
  ['credit', '8500000', '13455000'],
  ['debit', '120050', '13334950'],
  ['debit', '500000', '12834950'],
  ['credit', '250000', '13084950'],
  ['debit', '345678', '12739272'],
  ['debit', '80000', '12659272'],
  ['debit', '1000000', '11659272'],
];

export const EXPECTED_DATES = [
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
  '2026-10-07',
  '2026-10-08',
  '2026-10-09',
];
