import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';

/**
 * An invite link needs an account — against a real Supabase stack (ADR-006
 * amendment, 2026-10-11).
 *
 * Needs a stack with the migrations applied and `invite-accept` / `invite-mint`
 * served (`supabase start`, `supabase functions serve`), and:
 *
 *   E2E_SUPABASE_URL          e.g. http://127.0.0.1:54321
 *   E2E_SUPABASE_ANON_KEY     the publishable key
 *   E2E_SUPABASE_SERVICE_KEY  the service-role key (to make the two test accounts)
 *
 * The web server is started by playwright.config.ts with those same values, so
 * the page under test talks to the stack. Without them the whole file is
 * skipped, and says why. The mocked spec (`join-requires-account.spec.ts`)
 * covers the page; this covers the server and the round trip.
 *
 *   1. A (a real account) creates a group and mints its invite link.
 *   2. A fresh browser opens the link: Sign up / Log in, no guest option.
 *   3. A bare anonymous caller of the API is refused with ACCOUNT_REQUIRED.
 *   4. B logs in through the real form, lands in the group, and is a member.
 *   5. A guest session on the link is asked to create an account, and is not a
 *      member afterwards.
 */

const url = process.env.E2E_SUPABASE_URL;
const anonKey = process.env.E2E_SUPABASE_ANON_KEY;
const serviceKey = process.env.E2E_SUPABASE_SERVICE_KEY;
const live = Boolean(url && anonKey && serviceKey);

test.skip(
  !live,
  'needs a running Supabase stack: set E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY and E2E_SUPABASE_SERVICE_KEY',
);

const PASSWORD = 'correct-horse-battery-1';
const stamp = Date.now();

test('a link opened signed out needs sign up or log in, and logging in joins the group', async ({
  browser,
}) => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const person = async (label: string) => {
    const email = `e2e-join-${label}-${stamp}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error('no user');
    return { id: data.user.id, email };
  };
  const a = await person('a');
  const b = await person('b');

  // 1. A makes a group and an invite link.
  const clientA = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const signedA = await clientA.auth.signInWithPassword({ email: a.email, password: PASSWORD });
  expect(signedA.error).toBeNull();
  const created = await clientA.rpc('waves_create_group', {
    p_name: 'E2E join group',
    p_type: 'other',
    p_currency: 'INR',
  });
  expect(created.error).toBeNull();
  const groupId = created.data as string;
  const minted = await clientA.functions.invoke('invite-mint', { body: { groupId } });
  expect(minted.error).toBeNull();
  const token = (minted.data as { token: string }).token;

  // 2. A fresh browser opens the link.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/join#${token}`);
  await expect(page.getByRole('heading', { name: /added to E2E join group/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign up to join' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  await expect(page.getByRole('button', { name: /guest/i })).toHaveCount(0);

  // 3. The API refuses an anonymous caller outright.
  const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const anonSession = await anon.auth.signInAnonymously();
  expect(anonSession.error).toBeNull();
  const refused = await anon.functions.invoke('invite-accept', { body: { token, mode: 'join' } });
  expect(refused.error).not.toBeNull();
  const refusal = await (refused.error as { context: Response }).context.json();
  expect(refusal.code).toBe('ACCOUNT_REQUIRED');
  const anonMember = await admin
    .from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('profile_id', anonSession.data.user!.id);
  expect(anonMember.data).toEqual([]);

  // 4. B logs in through the real form, and the join completes by itself.
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByPlaceholder('you@email.com').fill(b.email);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(new RegExp(`/g/${groupId}`), { timeout: 30_000 });
  const member = await admin
    .from('group_members')
    .select('id, joined_via')
    .eq('group_id', groupId)
    .eq('profile_id', b.id);
  expect(member.data).toHaveLength(1);
  expect(member.data![0].joined_via).toBe('invite_link');
  await context.close();

  // 5. A guest session on the link is asked to create an account.
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  const guestClient = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const guestSession = await guestClient.auth.signInAnonymously();
  expect(guestSession.error).toBeNull();
  const storageKey = `sb-${new URL(url!).hostname.split('.')[0]}-auth-token`;
  await guestPage.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [storageKey, JSON.stringify(guestSession.data.session)],
  );
  await guestPage.goto(`/join#${token}`);
  await expect(guestPage.getByRole('button', { name: 'Create an account to join' })).toBeVisible();
  await expect(guestPage.getByRole('button', { name: /^join e2e join group$/i })).toHaveCount(0);
  const guestMember = await admin
    .from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('profile_id', guestSession.data.user!.id);
  expect(guestMember.data).toEqual([]);
  await guestContext.close();
});
