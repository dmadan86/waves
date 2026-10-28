import { describe, expect, it, vi } from 'vitest';
import { handleExportData } from './index.ts';

function query(data: unknown, error: unknown = null) {
  const q: Record<string, unknown> = {};
  let columns = '*';
  const result = () => {
    const project = (row: Record<string, unknown>) =>
      columns === '*' || columns.includes('(')
        ? row
        : Object.fromEntries(
            columns
              .split(',')
              .map((key) => key.trim())
              .filter((key) => key in row)
              .map((key) => [key, row[key]]),
          );
    return {
      data: Array.isArray(data)
        ? data.map(project)
        : data
          ? project(data as Record<string, unknown>)
          : data,
      error,
    };
  };
  q.select = (value: string) => {
    columns = value;
    return q;
  };
  q.eq = () => q;
  q.single = () => Promise.resolve(result());
  q.then = (resolve: (value: unknown) => void) => Promise.resolve(result()).then(resolve);
  return q;
}
function setup(options: { failEntries?: boolean; member?: boolean } = {}) {
  const group = { id: 'company', type: 'company', name: 'Office', default_currency: 'INR' };
  const ledger = {
    id: 'entry-a',
    group_id: 'company',
    member_id: 'employee-a',
    entry_kind: 'expense',
    category: 'fuel',
    amount: '123',
    currency: 'INR',
    occurred_on: '2026-11-05',
    status: 'submitted',
    note: '=unsafe',
    review_note: 'Check dates',
    version: 1,
    vendor: '=Private, Shop',
    gstin: '27AAPFU0939F1ZV',
    invoice_no: 'INV-7',
    gst_rate_bps: 1800,
    gst_amount_minor: '19',
    distance_km: '1.25',
    from_text: 'From A',
    to_text: 'To B',
    rate_minor: '3',
    calc_mode: 'distance_rate',
    reimbursement_id: 'covering-entry',
    reimbursement_details: { requestHash: 'test-hash', payoutMinor: '123' },
    storage_path: 'secret/key.jpg',
    preview: 'secret-preview',
  };
  const caller = {
    auth: { getUser: async () => ({ data: { user: { id: 'a' } }, error: null }) },
    rpc: vi.fn((name: string) =>
      name === 'waves_my_profile'
        ? query({ id: 'a', display_name: 'Employee A' })
        : Promise.resolve({ data: options.member === false ? null : 'employee-a', error: null }),
    ),
    from: vi.fn((table: string) =>
      table === 'groups'
        ? query(group)
        : table === 'company_entries'
          ? query([ledger], options.failEntries ? { message: 'database unavailable' } : null)
          : query([{ id: 'employee-a', profile: { display_name: 'Employee A' } }]),
    ),
  };
  const service = { from: vi.fn(() => query([])) };
  const deps = {
    asCaller: () => caller,
    asService: () => service,
    enforceRateLimit: vi.fn(async () => {}),
  } as never;
  const request = (format: string) =>
    new Request('https://example.test/export-data', {
      method: 'POST',
      body: JSON.stringify({ groupId: 'company', format }),
    });
  return { caller, service, deps, request };
}
describe('caller-visible company exports', () => {
  it.each(['json', 'csv'])(
    'exports only caller ledger fields without image metadata (%s)',
    async (format) => {
      const t = setup();
      const response = await handleExportData(t.request(format), t.deps);
      expect(response.status).toBe(200);
      const { content } = await response.json();
      expect(content).toContain('123');
      expect(content).toContain('Check dates');
      for (const value of [
        '27AAPFU0939F1ZV',
        'INV-7',
        '1800',
        '1.25',
        'From A',
        'To B',
        'covering-entry',
        'test-hash',
      ])
        expect(content).toContain(value);
      if (format === 'json')
        expect(JSON.parse(content).groups[0].companyEntries[0]).toMatchObject({
          vendor: '=Private, Shop',
          gst_amount_minor: '19',
          rate_minor: '3',
        });
      else {
        expect(content).toContain("'=Private, Shop");
        expect(content.split('\n')[0]).toContain('reimbursement_details');
      }
      expect(content).not.toContain('secret/key');
      expect(content).not.toContain('secret-preview');
      expect(t.caller.from).toHaveBeenCalledWith('company_entries');
      expect(t.service.from).not.toHaveBeenCalledWith('company_entries');
      if (format === 'json') expect(JSON.parse(content).groups[0].companyEntries).toHaveLength(1);
      else expect(content).toContain("'=unsafe");
    },
  );
  it('fails the entire export on a ledger read failure', async () => {
    const t = setup({ failEntries: true });
    expect((await handleExportData(t.request('json'), t.deps)).status).toBe(500);
  });
  it('refuses a former member before reading ledger data', async () => {
    const t = setup({ member: false });
    expect((await handleExportData(t.request('json'), t.deps)).status).toBe(403);
    expect(t.caller.from).not.toHaveBeenCalledWith('company_entries');
  });
});
