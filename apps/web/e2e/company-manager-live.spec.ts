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
 * A company MANAGER (role 'manager', not the owner) across different real accounts,
 * against a real Supabase stack. Same setup and skip rule as company-money-live.spec.ts:
 *   E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY / E2E_SUPABASE_SERVICE_KEY
 *
 * What the code says a manager may do (source of truth: lib/company/view.ts, entryForm.tsx,
 * useCompanyDocs.ts, workday.ts and the waves_company_* RPCs):
 *  - tasks: only for employees whose manager_id is them (useWorkdayAccess.people).
 *  - money: expense / bata / advance / reimbursement for their team, funded from the pool the
 *    owner gives them. NOT wages (owner only).
 *  - estimates & bills: allowed, but a manager sees only the documents they created.
 *  - approvals: claims and leave of their own team, never their own, never other teams'.
 *
 * Accounts (one browser context each, real sign-in form): owner, manager, employee (managed),
 * other (an employee with no manager_id, so not this manager's).
 * Figures (INR): pool 5,000, advance 500, claim 1,200 -> reimbursed 700 net of the advance.
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
const COMPANY = `E2E Manager Co ${stamp}`;
const TASK = `Paint the gate ${stamp}`;
const OWNER_BILL_CUSTOMER = `Owner Customer ${stamp}`;
const MANAGER_BILL_CUSTOMER = `Manager Customer ${stamp}`;
const MANAGER_ESTIMATE_CUSTOMER = `Manager Estimate ${stamp}`;

/** "₹1,200" or "₹1,200.00", but never a prefix of a bigger number. */
const inr = (n: number) => new RegExp(`₹\\s?${n.toLocaleString('en-IN')}(\\.00)?(?![\\d,])`);

interface Person {
  id: string;
  email: string;
  name: string;
}

let admin: SupabaseClient;
let ownerApi: SupabaseClient;
let managerApi: SupabaseClient;
let owner: Person;
let manager: Person;
let employee: Person;
let other: Person;
let groupId = '';
let managerMemberId = '';
let empMemberId = '';
let otherMemberId = '';
let ownerCtx: BrowserContext;
let managerCtx: BrowserContext;
let empCtx: BrowserContext;
let otherCtx: BrowserContext;

async function makePerson(label: string, name: string): Promise<Person> {
  const email = `e2e-mgr-${label}-${stamp}@example.com`;
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

async function apiFor(who: Person): Promise<SupabaseClient> {
  const api = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const signed = await api.auth.signInWithPassword({ email: who.email, password: PASSWORD });
  expect(signed.error).toBeNull();
  return api;
}

async function addMember(who: Person, role: string, managerId: string | null) {
  const added = await admin
    .from('group_members')
    .insert({ group_id: groupId, profile_id: who.id, role, manager_id: managerId })
    .select('id')
    .single();
  expect(added.error).toBeNull();
  return added.data!.id as string;
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

async function saveEntry(page: Page, amount: string) {
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByText(/^✓/)).toBeVisible({ timeout: 30_000 });
}

/** Fill and save the document form; `type` is the route's ?type= value. */
async function newDoc(page: Page, type: 'bill' | 'estimate', customer: string, rate: string) {
  await page.goto(`/c/${groupId}/bills/new?type=${type}`);
  await page.getByLabel(/^customer name/i).fill(customer);
  await page.getByLabel(/^description 1/i).fill('Site work');
  await page.getByLabel(/^qty$/i).first().fill('1');
  await page
    .getByLabel(/^rate$/i)
    .first()
    .fill(rate);
  await page.getByRole('button', { name: /^save$/i }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 30_000 });
}

const today = new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const taskArgs = (memberId: string, title: string) => ({
  p_group_id: groupId,
  p_task_id: crypto.randomUUID(),
  p_member_id: memberId,
  p_day: today,
  p_title: title,
  p_project_id: null,
  p_status: 'todo',
  p_blocked_reason: null,
  p_note: null,
  p_due_time: null,
});

test.describe.serial('company manager, one browser per person', () => {
  test.beforeAll(async ({ browser }) => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    owner = await makePerson('owner', 'Olivia Owner');
    manager = await makePerson('mgr', 'Manoj Manager');
    employee = await makePerson('emp', 'Ravi Managed');
    other = await makePerson('other', 'Uma Unmanaged');

    // The owner makes the company through the real "New company" screen.
    ownerCtx = await signInForm(browser, owner);
    const page = await ownerCtx.newPage();
    await page.goto('/companies/new');
    await page.getByLabel('Company name').fill(COMPANY);
    await page.getByRole('button', { name: 'Create company' }).click();
    await page.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 30_000 });
    groupId = page.url().match(/\/c\/([0-9a-f-]{36})/)![1];
    await page.close();

    managerMemberId = await addMember(manager, 'manager', null);
    empMemberId = await addMember(employee, 'member', managerMemberId);
    otherMemberId = await addMember(other, 'member', null);

    ownerApi = await apiFor(owner);
    managerApi = await apiFor(manager);
    managerCtx = await signInForm(browser, manager);
    empCtx = await signInForm(browser, employee);
    otherCtx = await signInForm(browser, other);
  });

  test.afterAll(async () => {
    await Promise.allSettled([
      ownerCtx?.close(),
      managerCtx?.close(),
      empCtx?.close(),
      otherCtx?.close(),
    ]);
    // No data cleanup: activity_log is append-only, so a company can't be deleted, even by the
    // service role. Each run uses unique emails (as join-live.spec.ts does); run against staging only.
  });

  test('manager adds a task for their own employee, and can only pick that employee', async () => {
    // The unmanaged employee has a task too; the manager must never see it.
    const otherTask = await ownerApi.rpc(
      'waves_company_work_set',
      taskArgs(otherMemberId, `Owner task for Uma ${stamp}`),
    );
    expect(otherTask.error).toBeNull();

    const page = await managerCtx.newPage();
    await page.goto(`/c/${groupId}/team?seg=work`);
    await page.getByRole('button', { name: 'Add task' }).first().click();
    // Offered: the managed employee and the manager themself; never the unmanaged employee.
    const assignTo = page.getByRole('group', { name: 'Assign to' });
    await expect(assignTo.getByRole('checkbox')).toHaveCount(2);
    await expect(assignTo).toContainText(employee.name);
    await expect(assignTo).toContainText(manager.name);
    await expect(assignTo).not.toContainText(other.name);
    // Two people are offered, so nobody is pre-ticked.
    await assignTo.getByLabel(employee.name).check();
    await page.getByLabel('Task description').fill(TASK);
    await page.getByRole('button', { name: 'Save task' }).click();
    await expect(page.getByText(TASK)).toBeVisible();
    await page.close();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from('company_work_tasks')
          .select('member_id, status')
          .eq('group_id', groupId)
          .eq('title', TASK)
          .is('deleted_at', null);
        return (data ?? []).map((r) => [r.member_id, r.status]);
      })
      .toEqual([[empMemberId, 'todo']]);

    // The managed employee sees it in their own tasks.
    const emp = await empCtx.newPage();
    await emp.goto(`/c/${groupId}/team?seg=work`);
    await expect(emp.getByText(TASK)).toBeVisible();
    await emp.close();

    // Row-level security: the manager's API reads their team's tasks, not Uma's.
    const seen = await managerApi.from('company_work_tasks').select('title, member_id');
    expect(seen.error).toBeNull();
    expect(seen.data!.map((r) => r.member_id)).toEqual([empMemberId]);
  });

  test('manager cannot assign a task to an employee outside their team', async () => {
    const title = `Sneaky task ${stamp}`;
    const res = await managerApi.rpc('waves_company_work_set', taskArgs(otherMemberId, title));
    expect(res.error).not.toBeNull();
    const { data } = await admin
      .from('company_work_tasks')
      .select('id')
      .eq('group_id', groupId)
      .eq('title', title);
    expect(data).toEqual([]);
  });

  test('owner funds the manager; the manager records an advance from that pool, not wages', async () => {
    const funded = await ownerApi.rpc('waves_company_pool_post', {
      p_group_id: groupId,
      p_entry_id: crypto.randomUUID(),
      p_manager_id: managerMemberId,
      p_kind: 'allocation',
      p_amount_minor: 500000,
      p_project_id: null,
      p_occurred_on: today,
      p_reason: null,
    });
    expect(funded.error).toBeNull();

    const page = await managerCtx.newPage();
    await page.goto(`/c/${groupId}/entry/new?member=${empMemberId}`);
    const type = page.getByRole('combobox', { name: 'Type', exact: true });
    await expect(type).toHaveValue('advance');
    // Wages are an owner-only kind.
    await expect(type.locator('option', { hasText: 'Wages paid' })).toHaveCount(0);
    // The person picker lists the manager's team, never the unmanaged employee.
    const who = page.getByRole('combobox', { name: 'Employee' });
    await expect(who.locator('option', { hasText: employee.name })).toHaveCount(1);
    await expect(who.locator('option', { hasText: other.name })).toHaveCount(0);
    await saveEntry(page, '500');
    await page.close();

    const advances = await ofKind('advance');
    expect(advances.map((e) => [Number(e.amount), e.status, e.member_id])).toEqual([
      [50000, 'approved', empMemberId],
    ]);
    expect(advances[0].funding_manager_id).toBe(managerMemberId);
    expect(await ofKind('wages')).toEqual([]);
  });

  test('manager raises a bill and an estimate; they see only their own, not the owner bill', async () => {
    const own = await ownerCtx.newPage();
    await newDoc(own, 'bill', OWNER_BILL_CUSTOMER, '1000');
    await own.close();

    const page = await managerCtx.newPage();
    await newDoc(page, 'bill', MANAGER_BILL_CUSTOMER, '1000');
    await newDoc(page, 'estimate', MANAGER_ESTIMATE_CUSTOMER, '800');
    await page.goto(`/c/${groupId}/bills`);
    await expect(
      page.getByText('Only owners and managers can use estimates and bills.'),
    ).toHaveCount(0);
    await expect(page.getByText(MANAGER_BILL_CUSTOMER).first()).toBeVisible();
    await expect(page.getByText(MANAGER_ESTIMATE_CUSTOMER).first()).toBeVisible();
    await expect(page.getByText(OWNER_BILL_CUSTOMER)).toHaveCount(0);
    await page.close();

    // The owner sees all three.
    const o = await ownerCtx.newPage();
    await o.goto(`/c/${groupId}/bills`);
    for (const customer of [
      OWNER_BILL_CUSTOMER,
      MANAGER_BILL_CUSTOMER,
      MANAGER_ESTIMATE_CUSTOMER,
    ]) {
      await expect(o.getByText(customer).first()).toBeVisible();
    }
    await o.close();
  });

  test('manager approves the managed employee claim, not the unmanaged one', async () => {
    const on = await ownerApi.rpc('waves_company_settings_set', {
      p_group_id: groupId,
      p_default_daily_rate_minor: null,
      p_approvals_enabled: true,
    });
    expect(on.error).toBeNull();

    // Both employees raise a 1,200 claim in their own browsers.
    for (const ctx of [empCtx, otherCtx]) {
      const page = await ctx.newPage();
      await page.goto(`/c/${groupId}/entry/new`);
      await saveEntry(page, '1200');
      await page.close();
    }
    await expect
      .poll(async () => (await ofKind('expense')).filter((e) => e.status === 'submitted').length)
      .toBe(2);
    const claims = await ofKind('expense');
    const mine = claims.find((e) => e.member_id === empMemberId)!;
    const theirs = claims.find((e) => e.member_id === otherMemberId)!;

    // Pending shows exactly one claim to the manager: their employee's.
    const page = await managerCtx.newPage();
    await page.goto(`/c/${groupId}/pending`);
    await expect(page.getByText('Claims awaiting approval')).toBeVisible();
    await expect(page.getByRole('button', { name: /^approve$/i })).toHaveCount(1);
    await page.getByRole('button', { name: /^approve$/i }).click();
    await expect.poll(() => statusOf(mine.id)).toBe('approved');
    expect(await statusOf(theirs.id)).toBe('submitted');
    await page.close();

    // Straight to the API: the manager cannot approve the unmanaged employee's claim.
    const res = await managerApi.rpc('waves_company_entry_transition', {
      p_entry_id: theirs.id,
      p_to: 'approved',
      p_note: null,
      p_expected_version: theirs.version,
    });
    expect(res.error).not.toBeNull();
    expect(await statusOf(theirs.id)).toBe('submitted');
  });

  test('manager reimburses the approved claim, net of the 500 advance', async () => {
    const page = await managerCtx.newPage();
    await page.goto(`/c/${groupId}/payments`);
    await expect(page.getByText(/^Total/)).toContainText(inr(700));
    await page.getByRole('button', { name: 'Mark as reimbursed' }).click();
    await expect
      .poll(async () => (await ofKind('reimbursement')).map((e) => Number(e.amount)))
      .toEqual([70000]);
    const [paid] = await ofKind('reimbursement');
    expect(paid.member_id).toBe(empMemberId);
    expect(paid.funding_manager_id).toBe(managerMemberId);
    await page.close();
  });

  test('manager approves leave from their employee, not from the unmanaged one', async () => {
    const ask = async (who: Person, memberId: string, id: string, day: string) => {
      const res = await (
        await apiFor(who)
      ).rpc('waves_company_leave_set', {
        p_group_id: groupId,
        p_id: id,
        p_member_id: memberId,
        p_start: day,
        p_end: day,
        p_half: false,
        p_kind: 'casual',
        p_reason: null,
      });
      expect(res.error).toBeNull();
    };
    const mineId = crypto.randomUUID();
    const theirsId = crypto.randomUUID();
    await ask(employee, empMemberId, mineId, inDays(5));
    await ask(other, otherMemberId, theirsId, inDays(6));

    // Both claims are decided by now, so the only Approve button left is for leave.
    const page = await managerCtx.newPage();
    await page.goto(`/c/${groupId}/pending`);
    await expect(page.getByText('Leave requests')).toBeVisible();
    await expect(page.getByRole('button', { name: /^approve$/i })).toHaveCount(1);
    await page.getByRole('button', { name: /^approve$/i }).click();
    const leaveStatus = async (id: string) =>
      (await admin.from('company_leave').select('status').eq('id', id).single()).data?.status;
    await expect.poll(() => leaveStatus(mineId)).toBe('approved');
    expect(await leaveStatus(theirsId)).toBe('pending');
    await page.close();
  });

  test('manager cannot see owner-only things: company-paid rows, the unmanaged employee, settings', async () => {
    // Owner pays a company expense directly; a manager only sees company-paid rows they made.
    const own = await ownerCtx.newPage();
    await own.goto(`/c/${groupId}/entry/new`);
    await own
      .getByRole('combobox', { name: 'Paid by' })
      .selectOption({ label: 'Company paid directly' });
    await saveEntry(own, '3000');
    await own.close();

    const seen = await managerApi.from('company_entries').select('member_id, paid_by_company');
    expect(seen.error).toBeNull();
    expect(seen.data!.some((r) => r.paid_by_company)).toBe(false);
    expect(seen.data!.some((r) => r.member_id === otherMemberId)).toBe(false);

    const page = await managerCtx.newPage();
    await page.goto(`/c/${groupId}/team?seg=people`);
    await expect(page.getByText(employee.name).first()).toBeVisible();
    await expect(page.getByText(other.name)).toHaveCount(0);
    await page.close();

    // Owner-only settings: a manager cannot switch approvals off.
    const off = await managerApi.rpc('waves_company_settings_set', {
      p_group_id: groupId,
      p_default_daily_rate_minor: null,
      p_approvals_enabled: false,
    });
    expect(off.error).not.toBeNull();
    const group = await admin
      .from('groups')
      .select('company_approvals_enabled')
      .eq('id', groupId)
      .single();
    expect(group.data?.company_approvals_enabled).toBe(true);
  });

  test.fixme('manager records wages for their employee', async () => {
    // Wages are owner-only (entryForm.tsx kinds exclude 'wages' for managers); the absence of the
    // option and the table-level refusal are asserted above.
  });
});
