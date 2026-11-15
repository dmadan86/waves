import { test, expect, type Page, type Route } from '@playwright/test';

import { change, mockBackend, signInAs, type SentMutation } from './support/company';

/**
 * The Me page and the statement import, against fixtures: a seeded session, the
 * `sync` function answered from memory (including the personal-ledger rows a
 * write produces), `waves_my_plan`, the feature flag, and the spending-ask
 * function stubbed by its contract. No real account or project is touched.
 */

const ME = '44444444-4444-4444-8444-444444444444';
const SCOPE = `${ME}:personal`;
const SUPABASE = 'https://example.supabase.co';

const HDFC = [
  'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '01/09/26,UPI-SWIGGY-SWIGGY@ICICI-ICIC0000001-624512345678-FOOD,0000624512345678,01/09/26,250.00,,9750.00',
  '02/09/26,SALARY SEP,0000000000000001,02/09/26,,50000.00,59750.00',
  '03/09/26,POS 4512XXXXXXXX1234 BIGBASKET,0000000000000002,03/09/26,1200.50,,58549.50',
].join('\n');
const statement = { name: 'hdfc.csv', mimeType: 'text/csv', buffer: Buffer.from(HDFC) };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function txnRow(id: string, data: Record<string, unknown>, deleted: string | null = null) {
  return change(
    'personal_records',
    {
      id,
      owner_user_id: ME,
      record_kind: 'txn',
      data,
      created_at: '2026-11-01T00:00:00Z',
      deleted_at: deleted,
    },
    SCOPE,
  );
}

/** A ledger that echoes writes back the way the server does. */
async function openAs(
  page: Page,
  plan: 'free' | 'pro',
  opts: { flag?: boolean; seed?: boolean } = {},
) {
  await signInAs(page, ME);
  const backend = await mockBackend(page, {
    changes: opts.seed
      ? [
          txnRow('11111111-aaaa-4aaa-8aaa-000000000001', {
            kind: 'expense',
            amount: '45000',
            currency: 'INR',
            category: 'food',
            note: 'Lunch',
            date: todayIso(),
          }),
          txnRow('11111111-aaaa-4aaa-8aaa-000000000002', {
            kind: 'expense',
            amount: '20000',
            currency: 'INR',
            category: 'transport',
            note: 'Cab',
            date: todayIso(),
          }),
        ]
      : [],
    rpc: { waves_my_plan: { plan } },
    rest: {
      feature_flags: opts.flag
        ? [{ key: 'spending_ask', enabled: true, rollout_percent: 100, variants: ['on', 'off'] }]
        : [],
    },
    onMutation: (m: SentMutation) => {
      if (m.kind === 'personal.upsert') {
        return [txnRow(m.payload.recordId, m.payload.data)];
      }
      if (m.kind === 'personal.delete') {
        return [txnRow(m.payload.recordId, {}, new Date().toISOString())];
      }
    },
  });
  return backend;
}

const upserts = (mutations: SentMutation[]) =>
  mutations.filter((m) => m.kind === 'personal.upsert');

test.describe('Me: the private ledger', () => {
  test('lists entries by day with the month totals by category', async ({ page }) => {
    await openAs(page, 'free', { seed: true });
    await page.goto('/me');
    await expect(page.getByText('Lunch')).toBeVisible();
    await expect(page.getByText('Cab')).toBeVisible();
    await expect(page.getByTestId('me-spent')).toContainText('650');
    await expect(page.getByRole('list', { name: 'Where it went' })).toContainText('Food');
  });

  test('add, edit and delete send personal mutations on the owner’s own scope', async ({
    page,
  }) => {
    const backend = await openAs(page, 'free', { seed: true });
    await page.goto('/me');
    await page.getByRole('button', { name: 'Add entry' }).click();
    await page.getByLabel(/^amount/i).fill('99.50');
    await page.getByLabel('Note').fill('Books');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => upserts(backend.mutations).length).toBe(1);
    const [add] = upserts(backend.mutations);
    expect(add.groupId).toBe(SCOPE);
    expect(add.payload).toMatchObject({
      recordKind: 'txn',
      data: { amount: '9950', note: 'Books' },
    });
    await expect(page.getByText('Books')).toBeVisible();

    await page.getByRole('button', { name: 'Edit Lunch' }).click();
    await page.getByLabel(/^amount/i).fill('500');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => upserts(backend.mutations).length).toBe(2);
    expect(upserts(backend.mutations)[1].payload).toMatchObject({
      recordId: '11111111-aaaa-4aaa-8aaa-000000000001',
      data: { amount: '50000', note: 'Lunch' },
    });

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete Cab' }).click();
    await expect
      .poll(() => backend.mutations.filter((m) => m.kind === 'personal.delete').length)
      .toBe(1);
    await expect(page.getByText('Cab')).toHaveCount(0);
  });

  test('a zero amount is refused and nothing is sent', async ({ page }) => {
    const backend = await openAs(page, 'free', { seed: true });
    await page.goto('/me');
    await page.getByRole('button', { name: 'Add entry' }).click();
    await page.getByLabel(/^amount/i).fill('0');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Enter an amount above zero.')).toBeVisible();
    expect(backend.mutations).toHaveLength(0);
  });
});

test.describe('Me: statement import', () => {
  test('Free sees a preview of the file, then the upgrade card, and nothing is written', async ({
    page,
  }) => {
    const backend = await openAs(page, 'free');
    await page.goto('/me/import');
    await page.getByTestId('statement-file').setInputFiles(statement);
    await expect(page.getByTestId('preview-summary')).toContainText('3 transactions');
    await expect(page.getByTestId('preview-summary')).toContainText('1,450.50');
    await expect(page.getByText('SWIGGY', { exact: false }).first()).toBeVisible();
    const card = page.getByTestId('upgrade-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('link', { name: 'See Pro' })).toHaveAttribute(
      'href',
      '/settings/plan',
    );
    expect(upserts(backend.mutations)).toHaveLength(0);
  });

  test('Free is stopped after two previews in a month', async ({ page }) => {
    await openAs(page, 'free');
    await page.goto('/me/import');
    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId('statement-file').setInputFiles(statement);
      await page.getByRole('button', { name: 'Import another' }).click();
    }
    await page.getByTestId('statement-file').setInputFiles(statement);
    await expect(page.getByText('No free previews left this month.')).toBeVisible();
    await expect(page.getByTestId('upgrade-card')).toBeVisible();
  });

  test('a PDF is refused with a clear message', async ({ page }) => {
    await openAs(page, 'pro');
    await page.goto('/me/import');
    await page.getByTestId('statement-file').setInputFiles({
      name: 'locked.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7'),
    });
    await expect(page.locator('p.error')).toContainText(
      'PDF statements, including password-protected ones',
    );
  });

  test('Pro reviews, edits, confirms; then a second upload is flagged as already added', async ({
    page,
  }) => {
    const backend = await openAs(page, 'pro');
    await page.goto('/me/import');
    await page.getByTestId('statement-file').setInputFiles(statement);
    await expect(page.getByRole('heading', { name: 'Review 3 rows' })).toBeVisible();
    // Nothing is written before confirm.
    expect(upserts(backend.mutations)).toHaveLength(0);

    // Money out is ticked, money in is not; fix one amount and one category.
    await expect(page.getByRole('checkbox', { name: /Add this row: SWIGGY/i })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Add this row: SALARY/i })).not.toBeChecked();
    await page.getByLabel(/^Amount: SWIGGY/i).fill('260');
    await page.getByLabel(/^Category: SWIGGY/i).selectOption({ label: 'Food & drink' });
    await expect(page.getByTestId('selected-summary')).toContainText('2 selected');
    await page.getByRole('button', { name: 'Add 2 to my ledger' }).click();

    await expect(page.getByRole('heading', { name: 'Added 2 entries' })).toBeVisible();
    const written = upserts(backend.mutations);
    expect(written).toHaveLength(2);
    for (const m of written) {
      expect(m.groupId).toBe(SCOPE);
      expect(m.payload.recordKind).toBe('txn');
      expect(m.payload.recordId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(written.map((m) => m.payload.data.amount).sort()).toEqual(['120050', '26000']);

    // Same file again, inside the same page session: the unedited debit is recognised.
    await page.getByRole('link', { name: 'Back to Me' }).first().click();
    await page.getByRole('link', { name: 'Import statement' }).click();
    await page.getByTestId('statement-file').setInputFiles(statement);
    await expect(page.getByRole('heading', { name: /^Review 3 rows/ })).toBeVisible();
    // SWIGGY was saved at an edited amount, so it is a new row; BIGBASKET was saved as printed.
    await expect(
      page.getByRole('checkbox', { name: /Add this row: BIGBASKET/i }),
    ).not.toBeChecked();
    await expect(page.getByText('Looks already added.').first()).toBeVisible();
  });
});

test.describe('Me: ask about my spending', () => {
  async function stubAsk(page: Page, onBody?: (body: unknown) => void) {
    await page.route(`${SUPABASE}/functions/v1/spending-ask`, async (route: Route) => {
      const headers = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*',
        'content-type': 'application/json',
      };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      onBody?.(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          answer: 'Most of your money went to food this month.',
          facts: [{ label: 'Food', amountMinor: '45000', currency: 'INR' }],
          subscriptions: [
            {
              merchant: 'Netflix',
              amountMinor: '19900',
              currency: 'INR',
              cadence: 'monthly',
              lastDate: '2026-11-02',
            },
          ],
        }),
      });
    });
  }

  test('Pro with the flag on asks and sees the mocked answer', async ({ page }) => {
    let body: any;
    await openAs(page, 'pro', { flag: true, seed: true });
    await stubAsk(page, (b) => (body = b));
    await page.goto('/me');
    await page.getByLabel('Your question').fill('Where did my money go?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const answer = page.getByTestId('ask-answer');
    await expect(answer).toContainText('Most of your money went to food this month.');
    await expect(answer).toContainText('450');
    await expect(answer).toContainText('Netflix');
    expect(body).toMatchObject({ question: 'Where did my money go?', currency: 'INR' });
    expect(body.from).toMatch(/^\d{4}-\d{2}-01$/);
  });

  test('is hidden when the flag is off', async ({ page }) => {
    await openAs(page, 'pro', { flag: false, seed: true });
    await page.goto('/me');
    await expect(page.getByText('Lunch')).toBeVisible();
    await expect(page.getByText('Ask about my spending')).toHaveCount(0);
  });

  test('on Free it points at the plan page instead of asking', async ({ page }) => {
    await openAs(page, 'free', { flag: true, seed: true });
    await page.goto('/me');
    await expect(page.getByText('Asking about your spending is a Pro feature.')).toBeVisible();
    await expect(page.getByLabel('Your question')).toHaveCount(0);
  });
});

test.describe('Me at phone width', () => {
  test('the ledger and the review list do not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openAs(page, 'pro', { flag: true, seed: true });
    const overflows = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

    await page.goto('/me');
    await expect(page.getByText('Lunch')).toBeVisible();
    await expect(page.getByLabel('Your question')).toBeVisible();
    expect(await overflows(), '/me').toBe(false);

    await page.goto('/me/import');
    await page.getByTestId('statement-file').setInputFiles(statement);
    await expect(page.getByRole('heading', { name: 'Review 3 rows' })).toBeVisible();
    expect(await overflows(), '/me/import review').toBe(false);
  });
});
