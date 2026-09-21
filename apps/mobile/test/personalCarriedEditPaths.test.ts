/**
 * Existing personal records may hold fields this app version does not know yet.
 *
 * The core codecs preserve those fields only when the app passes the decoded
 * record's `carried` bag back into the encoder. These editor paths rebuild
 * payloads from form state, so this source-level guard protects the hand-off at
 * the React boundary without mounting native screens in Vitest.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../src');
const source = (path: string): string => readFileSync(join(SRC, path), 'utf8');

describe('personal carried fields through edit screens', () => {
  it('passes existing txn and recurring carried fields through the shared entry builder', () => {
    const text = source('lib/personalEntry.ts');

    expect(text).toContain('carried: editing.txn?.carried');
    expect(text).toContain('carried: rule?.carried');
  });

  it('passes existing loan and budget carried fields through their editors', () => {
    expect(source('app/personal/loans.tsx')).toContain('carried: loan?.carried');
    expect(source('app/personal/budgets.tsx')).toContain('carried: budget?.carried');
  });
});
