import { test, expect } from '@playwright/test';

/**
 * The production shape: the site (SITE) proxies /app/* to this app, which is
 * built with basePath /app. Needs both servers running, so it is skipped
 * unless SITE_URL is given; the normal e2e suite runs the app at the root.
 */
const SITE = process.env.SITE_URL;
const LEGACY = process.env.LEGACY_URL;

test.describe('app under the site origin', () => {
  test.skip(!SITE, 'set SITE_URL (and LEGACY_URL) to run against the proxied pair');

  test('site header Sign in opens the app sign-in on the site origin', async ({ page }) => {
    await page.goto(`${SITE}/en`);
    await page
      .getByRole('link', { name: /^sign in$/i })
      .first()
      .click();
    await expect(page).toHaveURL(`${SITE}/app`);
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    // Hydrated: static assets came through the proxy.
    await page.getByRole('button', { name: /new here\? create an account/i }).click();
    await expect(page.getByRole('button', { name: /^create account$/i })).toBeVisible();
  });

  test('pages, assets and the callback load under /app', async ({ page }) => {
    const bad: string[] = [];
    const assets: string[] = [];
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (u.origin === new URL(SITE!).origin && r.status() >= 400)
        bad.push(`${r.status()} ${u.pathname}`);
      if (u.pathname.includes('/_next/static/')) assets.push(u.pathname);
    });
    for (const path of ['/app/groups', '/app/auth/callback', '/app/join']) {
      await page.goto(`${SITE}${path}`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(`${SITE}${path}`);
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    }
    expect(bad).toEqual([]);
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((p) => p.startsWith('/app/_next/'))).toBe(true);
  });

  test('Google sign-in asks to come back to the callback under /app', async ({ page }) => {
    let redirectTo = '';
    await page.route('https://example.supabase.co/**', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.endsWith('/authorize')) redirectTo = u.searchParams.get('redirect_to') ?? '';
      return route.fulfill({ status: 200, contentType: 'text/html', body: 'stop' });
    });
    await page.goto(`${SITE}/app`);
    await page.getByRole('button', { name: /continue with google/i }).click();
    await expect.poll(() => redirectTo).toBe(`${SITE}/app/auth/callback`);
  });

  test('site routes are not shadowed by the app, nor app routes by locales', async ({
    request,
  }) => {
    expect((await request.get(`${SITE}/en/privacy`)).status()).toBe(200);
    expect((await request.get(`${SITE}/privacy`, { maxRedirects: 0 })).status()).toBe(307);
    const robots = await (await request.get(`${SITE}/robots.txt`)).text();
    expect(robots).toContain('Disallow: /app/');
  });

  test('old app host redirects, but MCP and well-known stay put', async ({ request }) => {
    test.skip(!LEGACY, 'set LEGACY_URL');
    const r = await request.get(`${LEGACY}/g/abc?x=1`, { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    expect(r.headers().location).toBe(`${SITE}/app/g/abc?x=1`);
    const mcp = await request.post(`${LEGACY}/api/mcp`, { data: {}, maxRedirects: 0 });
    expect(mcp.status()).toBe(401);
    const meta = await (
      await request.get(`${LEGACY}/.well-known/oauth-protected-resource/api/mcp`)
    ).json();
    expect(new URL(meta.resource).pathname).toBe('/api/mcp');
    expect((await request.get(`${LEGACY}/.well-known/apple-app-site-association`)).status()).toBe(
      200,
    );
  });
});
