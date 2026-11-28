import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('company-vendor-add', () => {
  it('only lets an admin save a vendor (deep link by an employee)', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'app', 'group', '[id]', 'company-vendor-add.tsx'),
      'utf8',
    );
    expect(src).toMatch(/const valid = canManage &&/);
  });
});
