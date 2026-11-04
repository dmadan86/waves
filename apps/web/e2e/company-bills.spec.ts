import { test, expect } from '@playwright/test';

import {
  GROUP,
  OWNER_PROFILE,
  mockBackend,
  ownerMirror,
  people,
  signInAs,
} from './support/company';

const owner = () => ({
  changes: ownerMirror(),
  rpc: { waves_company_people: people },
});

test.describe('company bills and settings slice (fixtures, no real account)', () => {
  test('new bill computes totals and saves with discount applied', async ({ page }) => {
    await signInAs(page, OWNER_PROFILE);
    const backend = await mockBackend(page, owner());
    await page.goto(`/c/${GROUP}/bills/new?type=bill`);
    await page.getByLabel(/^customer name/i).fill('Walk-in customer');
    await page.getByLabel(/^description 1/i).fill('Tiles');
    await page.getByLabel(/^qty$/i).first().fill('3');
    await page
      .getByLabel(/^rate$/i)
      .first()
      .fill('150.50');
    await page.getByLabel(/^discount/i).fill('51.50'); // discount
    // 3 x 150.50 = 451.50, less 51.50 = 400.00
    await expect(page.getByText(/Total:.*400\.00/)).toBeVisible();
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect.poll(() => backend.mutations.length).toBeGreaterThanOrEqual(1);
    const save = backend.mutations.find((m) => m.kind === 'company_doc.save');
    expect(save).toBeTruthy();
    expect(save!.payload.data).toMatchObject({
      docType: 'bill',
      customerName: 'Walk-in customer',
      items: [{ description: 'Tiles', qtyMilli: '3000', rateMinor: '15050' }],
      discountMinor: '5150',
    });
  });

  test('settings: adding a receipt rule sends company.policies_set', async ({ page }) => {
    await signInAs(page, OWNER_PROFILE);
    const backend = await mockBackend(page, owner());
    await page.goto(`/c/${GROUP}/settings`);
    await page.getByRole('textbox', { name: /^receipt rule$/i }).fill('500');
    await page.getByRole('button', { name: /^receipt rule$/i }).click();
    await expect.poll(() => backend.mutations.length).toBe(1);
    const [m] = backend.mutations;
    expect(m.kind).toBe('company.policies_set');
    expect(m.payload.expectedRevision).toBe(0);
    expect(m.payload.policies.rules).toHaveLength(1);
    expect(m.payload.policies.rules[0]).toMatchObject({
      type: 'receipt_above',
      limitMinor: '50000',
    });
  });
});
