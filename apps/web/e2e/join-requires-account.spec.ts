import { test, expect, type Page } from '@playwright/test';

/**
 * An invite link needs an account (ADR-006 amendment, 2026-10-11).
 *
 * The browser half, against a mocked `invite-accept` so it runs in the same job
 * as the other specs with the placeholder Supabase env: the preview is real
 * page behaviour, the server's answers are canned. What it proves is what the
 * page offers and what it will and will not send:
 *
 *   - a signed-out visitor sees the group, the reason, "Sign up to join" and
 *     "Log in" — and no guest option and no join button;
 *   - nothing is sent to join, and no anonymous session is minted, however the
 *     page is poked at;
 *   - a guest session is asked to create an account instead of joining;
 *   - choosing a door opens the real sign-in form with the reason beside it.
 *
 * The same story against a real stack (create a group, open its link in a fresh
 * browser, log in through the UI, land in the group) is `join-live.spec.ts`.
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const PREVIEW = {
  group: { id: 'g-1', name: 'Goa trip', cover_emoji: null, default_currency: 'INR' },
  memberCount: 3,
  claimable: [],
};

/** Canned `invite-accept`; records every join attempt and every anonymous sign-in. */
async function mockServer(page: Page) {
  const joins: unknown[] = [];
  const anonymousSignIns: string[] = [];
  await page.route('**/functions/v1/invite-accept', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS });
    }
    const body = request.postDataJSON() as { mode?: string };
    if (body.mode === 'join') {
      joins.push(body);
      return route.fulfill({
        status: 403,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'ACCOUNT_REQUIRED', message: 'Create a free account' }),
      });
    }
    return route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify(PREVIEW),
    });
  });
  // Minting an anonymous (guest) session is a POST to /auth/v1/signup.
  await page.route('**/auth/v1/signup**', async (route) => {
    anonymousSignIns.push(route.request().url());
    await route.abort();
  });
  return { joins, anonymousSignIns };
}

/** A believable anonymous session in the place supabase-js keeps it. */
async function asGuest(page: Page) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    is_anonymous: true,
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: user.id,
      exp,
      role: 'authenticated',
      is_anonymous: true,
    })}.sig`,
    refresh_token: 'refresh-not-real',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  await page.addInitScript((value) => {
    // The key supabase-js derives from the project host (`example.supabase.co`).
    window.localStorage.setItem('sb-example-auth-token', JSON.stringify(value));
  }, session);
}

test.describe('invite link needs an account', () => {
  test('a signed-out visitor sees the group, the reason, Sign up and Log in — no guest way in', async ({
    page,
  }) => {
    const server = await mockServer(page);
    await page.goto('/join#tok-123');

    await expect(page.getByRole('heading', { name: /added to Goa trip/i })).toBeVisible();
    await expect(page.getByTestId('join-account-why')).toContainText(
      'Create a free account to join Goa trip so your expenses stay yours on every device.',
    );
    await expect(page.getByRole('button', { name: 'Sign up to join' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();

    // No way to join without an account, and nothing that says guest.
    await expect(page.getByRole('button', { name: /^join goa trip$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /guest/i })).toHaveCount(0);
    await expect(page.getByText(/continue as a guest|no account needed/i)).toHaveCount(0);

    expect(server.joins).toEqual([]);
    expect(server.anonymousSignIns).toEqual([]);
  });

  test('Sign up to join opens the account form with the reason and a way back', async ({
    page,
  }) => {
    const server = await mockServer(page);
    await page.goto('/join#tok-123');

    await page.getByRole('button', { name: 'Sign up to join' }).click();

    // The real sign-in card, on its create-account side.
    await expect(page.getByRole('button', { name: /^create account$/i })).toBeVisible();
    await expect(page.getByTestId('join-account-why')).toContainText('Goa trip');
    // The invite is remembered, so signing in brings the person back to it.
    const queued = await page.evaluate(() => window.localStorage.getItem('waves.afterSignIn'));
    expect(queued).toContain('tok-123');

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('button', { name: 'Sign up to join' })).toBeVisible();
    expect(server.joins).toEqual([]);
    expect(server.anonymousSignIns).toEqual([]);
  });

  test('Log in opens the sign-in side', async ({ page }) => {
    await mockServer(page);
    await page.goto('/join#tok-123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  });

  test('a guest session is asked to create an account, not joined', async ({ page }) => {
    const server = await mockServer(page);
    await asGuest(page);
    await page.goto('/join#tok-123');

    await expect(page.getByRole('button', { name: 'Create an account to join' })).toBeVisible();
    await expect(page.getByTestId('join-account-why')).toContainText(
      'You are using Waves as a guest. Create a free account to join Goa trip.',
    );
    await expect(page.getByRole('button', { name: /^join goa trip$/i })).toHaveCount(0);
    expect(server.joins).toEqual([]);
  });

  test('an old build that tries a guest join gets the server refusal, not a crash', async ({
    page,
  }) => {
    // What the server says to a client that skipped the screen: 403 with a code.
    const server = await mockServer(page);
    await page.goto('/join#tok-123');
    const status = await page.evaluate(async () => {
      const response = await fetch('https://example.supabase.co/functions/v1/invite-accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'tok-123', mode: 'join' }),
      });
      return { status: response.status, body: (await response.json()) as { code: string } };
    });
    expect(status.status).toBe(403);
    expect(status.body.code).toBe('ACCOUNT_REQUIRED');
    expect(server.joins).toHaveLength(1);
  });
});
