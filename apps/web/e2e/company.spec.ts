import { test, expect } from '@playwright/test';

import {
  EMP_PROFILE,
  GROUP,
  OWNER_PROFILE,
  employeeMirror,
  mockBackend,
  ownerMirror,
  people,
  signInAs,
} from './support/company';

test.describe('company (signed in, mirror served from fixtures)', () => {
  test('home renders for the owner with the claim waiting', async ({ page }) => {
    await signInAs(page, OWNER_PROFILE);
    await mockBackend(page, { changes: ownerMirror(), rpc: { waves_company_people: people } });
    await page.goto(`/c/${GROUP}`);
    await expect(page.getByRole('heading', { name: 'QA Works' })).toBeVisible();
    await expect(page.getByRole('link', { name: /add entry/i }).first()).toBeVisible();
    await expect(page.getByText('Ravi Employee').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: /company/i })).toBeVisible();
  });

  test('home renders for an employee: own entries, no admin bar', async ({ page }) => {
    await signInAs(page, EMP_PROFILE);
    await mockBackend(page, { changes: employeeMirror(), rpc: { waves_company_people: people } });
    await page.goto(`/c/${GROUP}`);
    await expect(page.getByRole('heading', { name: 'QA Works' })).toBeVisible();
    await expect(page.getByText('diesel').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: /company/i })).toHaveCount(0);
  });

  test('approving a pending claim sends company_entry.transition', async ({ page }) => {
    await signInAs(page, OWNER_PROFILE);
    const backend = await mockBackend(page, {
      changes: ownerMirror(),
      rpc: { waves_company_people: people },
    });
    await page.goto(`/c/${GROUP}/pending`);
    await page.getByRole('button', { name: /^approve$/i }).first().click();
    await expect.poll(() => backend.mutations.length).toBe(1);
    const [m] = backend.mutations;
    expect(m.kind).toBe('company_entry.transition');
    expect(m.groupId).toBe(GROUP);
    expect(m.payload).toMatchObject({ to: 'approved', expectedVersion: 1, note: null });
    expect(typeof m.payload.entryId).toBe('string');
  });

  test('/g/<companyId> redirects to /c/<companyId>', async ({ page }) => {
    await signInAs(page, OWNER_PROFILE);
    await mockBackend(page, {
      changes: ownerMirror(),
      rpc: { waves_company_people: people },
      rest: { groups: [{ id: GROUP, name: 'QA Works', type: 'company', default_currency: 'INR' }] },
    });
    await page.goto(`/g/${GROUP}`);
    await page.waitForURL(`**/c/${GROUP}`);
  });
});
