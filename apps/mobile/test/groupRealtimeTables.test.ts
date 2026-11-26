import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GROUP_REALTIME_TABLES } from '@/lib/groupRealtimeTables';

describe('group realtime', () => {
  it('listens to comments, and the table is published', () => {
    expect(GROUP_REALTIME_TABLES).toContain('expense_comments');
    const dir = join(__dirname, '../../../packages/db/prisma/migrations');
    const sql = readFileSync(
      join(dir, '20261227090000_realtime_expense_comments/migration.sql'),
      'utf8',
    );
    expect(sql).toContain('ADD TABLE public.expense_comments');
  });
});
