import { test, expect } from '@playwright/test';

import {
  GROUP,
  OWNER_PROFILE,
  change,
  mockBackend,
  ownerMirror,
  people,
  signInAs,
} from './support/company';

const client = (over: Record<string, unknown> = {}) =>
  change('company_clients', {
    id: 'cccccccc-0000-4000-8000-000000000001',
    name: 'Asha Builders',
    phone: '9000000001',
    need: 'Kitchen tiles',
    source: 'walk_in',
    stage: 'inquiry',
    expected_value: '250000',
    owner_member_id: null,
    created_by: 'aaaaaaaa-0000-4000-8000-000000000001',
    created_at: '2026-11-01T09:00:00Z',
    deleted_at: null,
    ...over,
  });

test.describe('company clients slice (fixtures, no real account)', () => {
  test('clients list shows the mirrored client', async ({ page }) => {
    await signInAs(page, OWNER_PROFILE);
    await mockBackend(page, {
      changes: [...ownerMirror(), client()],
      rpc: { waves_company_people: people },
    });
    await page.goto(`/c/${GROUP}/clients`);
    await expect(page.getByText('Asha Builders').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /add client/i })).toBeVisible();
  });

  test('add client saves the client then its first inquiry', async ({ page }) => {
    await signInAs(page, OWNER_PROFILE);
    const backend = await mockBackend(page, {
      changes: ownerMirror(),
      rpc: { waves_company_people: people },
    });
    await page.goto(`/c/${GROUP}/clients/new`);
    await page.getByLabel(/^name/i).fill('Meera Interiors');
    await page.getByLabel(/what do they need/i).fill('Wardrobe');
    await page.getByRole('button', { name: /save inquiry/i }).click();
    await expect.poll(() => backend.mutations.length).toBeGreaterThanOrEqual(2);
    const [set, inquiry] = backend.mutations;
    expect(set.kind).toBe('company_client.set');
    expect(set.payload).toMatchObject({ name: 'Meera Interiors', need: 'Wardrobe', stage: 'inquiry' });
    expect(inquiry.kind).toBe('company_inquiry.set');
    expect(inquiry.payload).toMatchObject({ clientId: set.payload.clientId, title: 'Wardrobe' });
  });
});
