import { test, expect } from '@playwright/test';

import { GROUP, OWNER_MEMBER, OWNER_PROFILE, change, mockBackend, ownerMirror, people, signInAs } from './support/company';

const VENDOR = 'dddddddd-0000-4000-8000-000000000001';
const vendor = () =>
  change('company_vendors', {
    id: VENDOR,
    name: 'Sharma Hardware',
    phone: null,
    category: null,
    added_by: OWNER_MEMBER,
    member_id: null,
    version: 1,
    deleted_at: null,
  });
const line = (id: string, kind: string, amount: string) =>
  change('company_vendor_entries', {
    id,
    vendor_id: VENDOR,
    kind,
    amount,
    occurred_on: '2026-11-01',
    note: null,
    status: 'approved',
    created_by: OWNER_MEMBER,
    funding_manager_id: null,
    version: 1,
    deleted_at: null,
  });
const mirror = () => [
  ...ownerMirror(),
  vendor(),
  line('dddddddd-0000-4000-8000-0000000000a1', 'bill', '500000'),
  line('dddddddd-0000-4000-8000-0000000000a2', 'payment', '200000'),
];

test.describe('company vendors slice (fixtures, no real account)', () => {
  test('vendor ledger shows the outstanding balance (bill minus payment)', async ({ page }) => {
    await signInAs(page, OWNER_PROFILE);
    await mockBackend(page, { changes: mirror(), rpc: { waves_company_people: people } });
    await page.goto(`/c/${GROUP}/vendors/${VENDOR}`);
    await expect(page.getByText('Sharma Hardware').first()).toBeVisible();
    await expect(page.getByText(/3,000/).first()).toBeVisible(); // 5,000 billed - 2,000 paid
  });

  test('record payment sends company_vendor_entry.create', async ({ page }) => {
    await signInAs(page, OWNER_PROFILE);
    const backend = await mockBackend(page, {
      changes: mirror(),
      rpc: { waves_company_people: people },
    });
    await page.goto(`/c/${GROUP}/vendors/${VENDOR}/pay`);
    await page.getByLabel(/^amount/i).fill('1250.50');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /^record payment$/i }).click();
    await expect.poll(() => backend.mutations.length).toBe(1);
    const [m] = backend.mutations;
    expect(m.kind).toBe('company_vendor_entry.create');
    expect(m.payload).toMatchObject({
      vendorId: VENDOR,
      kind: 'payment',
      amountMinor: '125050',
      method: 'cash',
    });
    await page.waitForURL(new RegExp(`/vendors/${VENDOR}/receipt/`));
  });
});
