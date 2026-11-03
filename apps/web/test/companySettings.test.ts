import { describe, expect, it } from 'vitest';

import {
  addDepartment,
  flipEffect,
  newLimitRule,
  parseCompanyTags,
  removeDepartment,
  renameDepartment,
  renameTag,
  settingsPayload,
  toggleTagHidden,
} from '@/lib/company/settings';
import { parseStorageUsage, storagePercent } from '@/lib/company/storage';
import { writeImportRow, tableFromBytes } from '@/lib/company/import';

describe('company settings', () => {
  it('settings payload keeps the unchanged field', () => {
    const g = { company_default_daily_rate_minor: '500', company_approvals_enabled: true };
    expect(settingsPayload(g, { approvalsEnabled: false })).toEqual({ defaultDailyRateMinor: '500', approvalsEnabled: false });
    expect(settingsPayload(g, { defaultDailyRateMinor: null })).toEqual({ defaultDailyRateMinor: null, approvalsEnabled: true });
  });

  it('departments reject blanks, duplicates', () => {
    const one = addDepartment([], ' Sales ', 'a')!;
    expect(one).toEqual([{ id: 'a', name: 'Sales' }]);
    expect(addDepartment(one, 'sales', 'b')).toBeNull();
    expect(addDepartment(one, ' ', 'b')).toBeNull();
    expect(renameDepartment(one, 'a', 'Ops')).toEqual([{ id: 'a', name: 'Ops' }]);
    expect(removeDepartment(one, 'a')).toEqual([]);
  });

  it('tags parse, rename and hide', () => {
    const tags = parseCompanyTags([{ key: 'fuel', label: 'Fuel' }, { key: 'BAD KEY', label: 'x' }, 3]);
    expect(tags).toEqual([{ key: 'fuel', label: 'Fuel' }]);
    expect(renameTag(tags, 'fuel', 'Diesel')[0]!.label).toBe('Diesel');
    expect(toggleTagHidden(tags, 'fuel')[0]!.hidden).toBe(true);
    expect(toggleTagHidden(toggleTagHidden(tags, 'fuel'), 'fuel')[0]!.hidden).toBeUndefined();
  });

  it('policy rules', () => {
    const rule = newLimitRule('r', 'fuel', 'day', 100n);
    expect(flipEffect([rule], 'r')[0]).toMatchObject({ effect: 'block' });
  });

  it('storage usage adds reserved bytes', () => {
    const u = parseStorageUsage([{ used_bytes: '50', reserved_bytes: 10, quota_bytes: '120' }]);
    expect(u).toEqual({ usedBytes: 60, quotaBytes: 120 });
    expect(storagePercent(u)).toBe(50);
  });
});

describe('company import', () => {
  it('reads a csv and refuses xlsx', () => {
    const t = tableFromBytes(new TextEncoder().encode('Name,Phone\nAsha,123\n'), 'a.csv');
    expect(t.rows.length).toBe(2);
    expect(() => tableFromBytes(new Uint8Array([1]), 'a.xlsx')).toThrow();
  });

  it('writes a vendor row with an opening balance', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    await writeImportRow(
      async (k, _g, p) => void calls.push([k, p]),
      'g',
      'vendor',
      { line: 2, cells: [], status: 'new', warnings: [], id: 'v1', values: { name: ' V ', phone: null, category: null, openingBalanceMinor: 700n } } as never,
      { owner: true, myMemberId: 'm', today: '2026-01-01' },
    );
    expect(calls.map((c) => c[0])).toEqual(['company_vendor.set', 'company_vendor_entry.create']);
    expect(calls[1]![1]).toMatchObject({ amountMinor: '700', vendorId: 'v1' });
  });
});
