import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  test,
  expect as baseExpect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

// `next dev` compiles each route on first visit, which can take well over the default 5 s.
const expect = baseExpect.configure({ timeout: 30_000 });

/**
 * Company money across DIFFERENT real accounts, against a real Supabase stack.
 *
 * Needs the migrations applied, the `sync` edge function served, and:
 *   E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY / E2E_SUPABASE_SERVICE_KEY
 * (the web server in playwright.config.ts is pointed at the same stack).
 * Without them the whole file is skipped. Same pattern as join-live.spec.ts.
 *
 * Accounts (one browser context each, real sign-in form): owner, employee, client.
 *
 * How the owner's words map onto what the product has:
 *  - "employee adds an advance": advances are an owner/manager record GIVEN to an
 *    employee (EMPLOYEE_ENTRY_KINDS is only expense + bata). So the owner records it.
 *  - "he raises a bill and it is settled": the employee raises an expense CLAIM,
 *    the owner approves it, then "Mark as reimbursed" settles it net of the advance.
 *  - "salary is separate": a Wages entry, which never moves the claim balance.
 *  - "company expenses are separate": an expense "Paid by: Company paid directly".
 *  - "client": estimates/bills are owner-side records for a customer; a client has
 *    no login role, so the client step asserts the account sees nothing.
 *
 * Figures (INR): advance 500, wages 20,000, company-paid 3,000, claim 1,200.
 * Claim less advance = 700 reimbursed. Bill 2 x 2,500 = 5,000, 2,000 part-paid.
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
const COMPANY = `E2E Money Co ${stamp}`;

/** "₹1,200" or "₹1,200.00", but never a prefix of a bigger number. */
const inr = (n: number) => new RegExp(`₹\\s?${n.toLocaleString('en-IN')}(\\.00)?(?![\\d,])`);

interface Person {
  id: string;
  email: string;
  name: string;
}

let admin: SupabaseClient;
let ownerApi: SupabaseClient;
let owner: Person;
let employee: Person;
let client: Person;
let groupId = '';
let empMemberId = '';
let ownerCtx: BrowserContext;
let empCtx: BrowserContext;
let clientCtx: BrowserContext;

async function makePerson(label: string, name: string): Promise<Person> {
  const email = `e2e-money-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('no user');
  // The profile row is made by the auth trigger; the name is what the app shows.
  const named = await admin.from('profiles').update({ display_name: name }).eq('id', data.user.id);
  if (named.error) throw named.error;
  return { id: data.user.id, email, name };
}

async function signInForm(browser: Browser, who: Person): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByPlaceholder('you@email.com').fill(who.email);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByPlaceholder('Password')).toHaveCount(0, { timeout: 30_000 });
  await page.close();
  return context;
}

/** Every live company_entries row for the group, oldest first. */
async function entries() {
  const { data, error } = await admin
    .from('company_entries')
    .select('*')
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('created_at');
  expect(error).toBeNull();
  return (data ?? []) as Array<Record<string, any>>;
}
const ofKind = async (kind: string) => (await entries()).filter((e) => e.entry_kind === kind);
const statusOf = async (id: string) => (await entries()).find((e) => e.id === id)?.status;

/** The balance card on the employee's statement. */
async function statement(page: Page) {
  await page.goto(`/c/${groupId}/statement/${empMemberId}`);
  return page.locator('.card', { has: page.getByText('Balance', { exact: true }) }).first();
}

async function saveEntry(page: Page, amount: string) {
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByText(/^✓/)).toBeVisible({ timeout: 30_000 });
}

test.describe.serial('company money, one browser per person', () => {
  test.beforeAll(async ({ browser }) => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    owner = await makePerson('owner', 'Olivia Owner');
    employee = await makePerson('emp', 'Ravi Employee');
    client = await makePerson('client', 'Carla Client');

    // The owner makes the company through the real "New company" screen.
    ownerCtx = await signInForm(browser, owner);
    const page = await ownerCtx.newPage();
    await page.goto('/companies/new');
    await page.getByLabel('Company name').fill(COMPANY);
    await page.getByRole('button', { name: 'Create company' }).click();
    await page.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 30_000 });
    groupId = page.url().match(/\/c\/([0-9a-f-]{36})/)![1];
    await page.close();

    // The employee is a member with a real account.
    const added = await admin
      .from('group_members')
      .insert({ group_id: groupId, profile_id: employee.id, role: 'member' })
      .select('id')
      .single();
    expect(added.error).toBeNull();
    empMemberId = added.data!.id;

    ownerApi = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signed = await ownerApi.auth.signInWithPassword({
      email: owner.email,
      password: PASSWORD,
    });
    expect(signed.error).toBeNull();

    empCtx = await signInForm(browser, employee);
    clientCtx = await signInForm(browser, client);
  });

  test.afterAll(async () => {
    await Promise.allSettled([ownerCtx?.close(), empCtx?.close(), clientCtx?.close()]);
    // No data cleanup: activity_log is append-only, so a company can't be deleted, even by the
    // service role. Each run uses unique emails (as join-live.spec.ts does); run against staging only.
  });

  test('owner records an advance, wages and a company-paid expense (approvals off)', async () => {
    const page = await ownerCtx.newPage();

    // Advance 500 given to the employee.
    await page.goto(`/c/${groupId}/entry/new?member=${empMemberId}`);
    await expect(page.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('advance');
    await saveEntry(page, '500');

    // Wages 20,000 for the employee.
    await page.goto(`/c/${groupId}/entry/new?member=${empMemberId}`);
    await page
      .getByRole('combobox', { name: 'Type', exact: true })
      .selectOption({ label: 'Wages paid' });
    await saveEntry(page, '20000');

    // Company paid 3,000 directly: no employee on it.
    await page.goto(`/c/${groupId}/entry/new`);
    await page
      .getByRole('combobox', { name: 'Paid by' })
      .selectOption({ label: 'Company paid directly' });
    await saveEntry(page, '3000');
    await page.close();

    const rows = await entries();
    const shape = (list: Array<Record<string, any>>) =>
      list.map((e) => [Number(e.amount), e.status, e.member_id ?? null]);
    expect(shape(rows.filter((e) => e.entry_kind === 'advance'))).toEqual([
      [50000, 'approved', empMemberId],
    ]);
    expect(shape(rows.filter((e) => e.entry_kind === 'wages'))).toEqual([
      [2000000, 'approved', empMemberId],
    ]);
    expect(rows.filter((e) => e.paid_by_company === true).map((e) => Number(e.amount))).toEqual([
      300000,
    ]);
  });

  test('salary and company expenses are separate: only the advance moves the balance', async () => {
    const page = await empCtx.newPage();
    const card = await statement(page);
    // Employee holds 500 of the company's. Wages (20,000) and the company-paid
    // 3,000 are not in the claim balance.
    await expect(card.locator('h2')).toContainText(inr(500));
    await expect(card).toContainText(/you have/i);
    await expect(card).not.toContainText(inr(20000));
    await expect(card).not.toContainText(inr(3000));
    // Wages are listed as wages; the company-paid expense is not visible to the employee.
    await expect(page.getByText(/wages/i).first()).toBeVisible();
    await expect(page.getByText(inr(3000))).toHaveCount(0);

    // Row-level security: the employee's API sees only their own rows.
    const empApi = createClient(url!, anonKey!, { auth: { persistSession: false } });
    expect(
      (await empApi.auth.signInWithPassword({ email: employee.email, password: PASSWORD })).error,
    ).toBeNull();
    const seen = await empApi.from('company_entries').select('amount, paid_by_company');
    expect(seen.error).toBeNull();
    expect(seen.data!.some((r) => r.paid_by_company)).toBe(false);
    expect(seen.data!.map((r) => Number(r.amount)).sort((a, b) => a - b)).toEqual([50000, 2000000]);
    await page.close();
  });

  test('employee claims 1,200; the owner approves; reimbursing pays 700 net of the advance', async () => {
    // Approvals on from now: new claims wait for the owner.
    const on = await ownerApi.rpc('waves_company_settings_set', {
      p_group_id: groupId,
      p_default_daily_rate_minor: null,
      p_approvals_enabled: true,
    });
    expect(on.error).toBeNull();

    // Employee raises the claim in their own browser.
    const emp = await empCtx.newPage();
    await emp.goto(`/c/${groupId}/entry/new`);
    await saveEntry(emp, '1200');
    await expect
      .poll(async () => (await ofKind('expense')).filter((e) => !e.paid_by_company).length)
      .toBe(1);
    const [claim] = (await ofKind('expense')).filter((e) => !e.paid_by_company);
    expect(Number(claim.amount)).toBe(120000);
    expect(claim.status).toBe('submitted');
    expect(claim.member_id).toBe(empMemberId);
    // Awaiting approval does not move the balance yet: still holding 500.
    await expect((await statement(emp)).locator('h2')).toContainText(inr(500));
    await emp.close();

    // Owner sees it in Pending and approves.
    const own = await ownerCtx.newPage();
    await own.goto(`/c/${groupId}/pending`);
    await expect(own.getByText('Claims awaiting approval')).toBeVisible();
    await own.getByRole('button', { name: /^approve$/i }).click();
    await expect.poll(() => statusOf(claim.id)).toBe('approved');

    // Payments: 1,200 claim less the 500 advance = 700 to pay.
    await own.goto(`/c/${groupId}/payments`);
    await expect(own.getByText(/^Total/)).toContainText(inr(700));
    await own.getByRole('button', { name: 'Mark as reimbursed' }).click();
    await expect.poll(() => statusOf(claim.id)).toBe('reimbursed');
    const paid = await ofKind('reimbursement');
    expect(paid.map((e) => [Number(e.amount), e.status, e.member_id])).toEqual([
      [70000, 'approved', empMemberId],
    ]);
    await own.close();
  });

  test('employee sees it settled, and the balance is exactly zero', async () => {
    const page = await empCtx.newPage();
    const card = await statement(page);
    await expect(card).toContainText('All settled');
    await expect(card.locator('h2')).toContainText(/₹\s?0(\.00)?(?![\d,])/);
    // The statement lists the reimbursement of 700 and the original claim of 1,200.
    await expect(page.getByText(inr(700)).first()).toBeVisible();
    await expect(page.getByText(inr(1200)).first()).toBeVisible();
    await page.close();

    // Wages and the company-paid expense are unchanged by all of this.
    expect((await ofKind('wages')).map((e) => Number(e.amount))).toEqual([2000000]);
    expect((await entries()).filter((e) => e.paid_by_company).map((e) => Number(e.amount))).toEqual(
      [300000],
    );
  });

  test('owner bills a customer 5,000, part-paid 2,000, then records the rest', async () => {
    const page = await ownerCtx.newPage();
    await page.goto(`/c/${groupId}/bills/new?type=bill`);
    await page.getByLabel(/^customer name/i).fill('Acme Customer');
    await page.getByLabel(/^description 1/i).fill('Site work');
    await page.getByLabel(/^qty$/i).first().fill('2');
    await page
      .getByLabel(/^rate$/i)
      .first()
      .fill('2500');
    await expect(page.getByText(/Total:/)).toContainText(inr(5000));
    await page.getByRole('button', { name: 'Part paid', exact: true }).click();
    await page.getByLabel('Amount received').fill('2000');
    await page.getByRole('button', { name: /^save$/i }).click();
    await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 30_000 });

    const row = (label: string) => page.locator('.row', { hasText: label });
    await expect(row('Payments received')).toContainText(inr(2000));
    await expect(row('Balance due')).toContainText(inr(3000));

    // The first button opens the form with the balance filled in; the last one records it.
    await page.getByRole('button', { name: 'Record payment' }).click();
    await page.getByRole('button', { name: 'Record payment' }).last().click();
    await expect(row('Payments received')).toContainText(inr(5000));
    await expect(row('Balance due')).toContainText(/₹\s?0(\.00)?(?![\d,])/);
    await page.close();
  });

  test('a client account cannot see the company, its entries or its bill', async () => {
    const page = await clientCtx.newPage();
    await page.goto(`/c/${groupId}`);
    await expect(page.getByRole('heading', { name: COMPANY })).toHaveCount(0);
    await page.close();

    const api = createClient(url!, anonKey!, { auth: { persistSession: false } });
    expect(
      (await api.auth.signInWithPassword({ email: client.email, password: PASSWORD })).error,
    ).toBeNull();
    for (const table of ['company_entries', 'company_documents']) {
      const res = await api.from(table).select('id').eq('group_id', groupId);
      expect(res.error).toBeNull();
      expect(res.data).toEqual([]);
    }
  });

  test.fixme('client logs in and sees, accepts or pays their bill', async () => {
    // No client portal exists: bills/estimates are owner-side records (CompanyDocument,
    // "Only owners and managers can use estimates and bills") and a CompanyClient is a
    // CRM row, not an account. Enable this when a client role/login ships.
  });

  test.fixme('employee records their own advance, or raises a bill to the company', async () => {
    // Employees can only enter expense and bata (EMPLOYEE_ENTRY_KINDS); advances are given by
    // an owner/manager, and bills are owner/manager-only. The employee's equivalent is the claim.
  });
});
