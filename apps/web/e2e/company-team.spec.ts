import { test, expect } from '@playwright/test';

import {
  EMP_MEMBER,
  EMP_PROFILE,
  GROUP,
  employeeMirror,
  mockBackend,
  people,
  signInAs,
} from './support/company';

test.describe('company team slice (fixtures, no real account)', () => {
  test('add entry sends company_entry.create with the typed amount, note and date', async ({
    page,
  }) => {
    await signInAs(page, EMP_PROFILE);
    const backend = await mockBackend(page, {
      changes: employeeMirror(),
      rpc: { waves_company_people: people },
    });
    await page.goto(`/c/${GROUP}/entry/new`);
    await page.getByLabel(/^amount/i).fill('125.50');
    await page.getByLabel(/^note/i).fill('site lunch');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect.poll(() => backend.mutations.length).toBe(1);
    const [m] = backend.mutations;
    expect(m.kind).toBe('company_entry.create');
    expect(m.groupId).toBe(GROUP);
    expect(m.payload).toMatchObject({
      entryKind: 'expense',
      memberId: EMP_MEMBER,
      data: { amount: '12550', note: 'site lunch' },
    });
    expect(m.payload.entryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.payload.data.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole('button', { name: /add another/i })).toBeVisible();
  });

  test('a zero amount is refused in the form, nothing is sent', async ({ page }) => {
    await signInAs(page, EMP_PROFILE);
    const backend = await mockBackend(page, {
      changes: employeeMirror(),
      rpc: { waves_company_people: people },
    });
    await page.goto(`/c/${GROUP}/entry/new`);
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText('Enter an amount.')).toBeVisible();
    expect(backend.mutations).toHaveLength(0);
  });
});
