import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect as baseExpect, type Browser, type BrowserContext } from '@playwright/test';

// `next dev` compiles each route on first visit, which can take well over the default 5 s.
const expect = baseExpect.configure({ timeout: 30_000 });

/**
 * Company leave policies and balances across DIFFERENT real accounts, against a real Supabase stack.
 *
 * Needs the migrations applied (incl. 20261208090000_company_leave_policies), the `sync` edge function
 * served, and E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY / E2E_SUPABASE_SERVICE_KEY. Without them the
 * whole file is skipped. Same pattern as company-money-live.spec.ts.
 *
 * Accounts (one browser context each, real sign-in form): owner, manager, employee (managed by the
 * manager), other (no manager). The web leave-policy screen (settings/leave) and balance card are not driven here yet, so the
 * owner sets the policy through the same RPC the app calls and the balances are read through the API;
 * the manager's approval goes through the real web Pending screen.
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
const COMPANY = `E2E Leave Co ${stamp}`;
const dayIso = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

interface Person {
  id: string;
  email: string;
  name: string;
}

let admin: SupabaseClient;
let owner: Person;
let manager: Person;
let employee: Person;
let other: Person;
let groupId = '';
let managerMemberId = '';
let empMemberId = '';
let otherMemberId = '';
let sickId = '';
let casualId = '';
let ownerCtx: BrowserContext;
let managerCtx: BrowserContext;
const apis = new Map<string, SupabaseClient>();

async function makePerson(label: string, name: string): Promise<Person> {
  const email = `e2e-leave-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('no user');
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

/** A signed-in API client for one person (their own RLS, their own RPC rights). */
async function apiFor(who: Person): Promise<SupabaseClient> {
  const cached = apis.get(who.id);
  if (cached) return cached;
  const api = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const signed = await api.auth.signInWithPassword({ email: who.email, password: PASSWORD });
  expect(signed.error).toBeNull();
  apis.set(who.id, api);
  return api;
}

const balance = async (memberId: string, typeId: string) => {
  const res = await admin.rpc('waves_company_leave_balance', {
    p_group_id: groupId,
    p_member_id: memberId,
    p_type_id: typeId,
    p_as_of: dayIso(0),
  });
  expect(res.error).toBeNull();
  return Number(res.data);
};

const ask = (who: Person, memberId: string, typeId: string | null, start: string, end: string) => {
  const id = crypto.randomUUID();
  return apiFor(who).then(async (api) => {
    const res = await api.rpc('waves_company_leave_set', {
      p_group_id: groupId,
      p_id: id,
      p_member_id: memberId,
      p_start: start,
      p_end: end,
      p_half: false,
      p_kind: 'other',
      p_reason: null,
      p_leave_type_id: typeId,
    });
    expect(res.error).toBeNull();
    return id;
  });
};
const decide = async (who: Person, id: string, approve: boolean) =>
  (await apiFor(who)).rpc('waves_company_leave_decide', {
    p_group_id: groupId,
    p_id: id,
    p_approve: approve,
    p_note: null,
  });
const statusOf = async (id: string) =>
  (await admin.from('company_leave').select('status').eq('id', id).single()).data?.status;
const heard = async (profileId: string, kind: string) =>
  (
    await admin
      .from('notifications')
      .select('id')
      .eq('group_id', groupId)
      .eq('profile_id', profileId)
      .eq('kind', kind)
  ).data?.length ?? 0;

test.describe.serial('company leave policies, one browser per person', () => {
  test.beforeAll(async ({ browser }) => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    owner = await makePerson('owner', 'Olivia Owner');
    manager = await makePerson('mgr', 'Mohan Manager');
    employee = await makePerson('emp', 'Ravi Employee');
    other = await makePerson('oth', 'Omar Other');

    ownerCtx = await signInForm(browser, owner);
    const page = await ownerCtx.newPage();
    await page.goto('/companies/new');
    await page.getByLabel('Company name').fill(COMPANY);
    await page.getByRole('button', { name: 'Create company' }).click();
    await page.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 30_000 });
    groupId = page.url().match(/\/c\/([0-9a-f-]{36})/)![1];
    await page.close();

    const add = async (who: Person, role: string, managerId: string | null) => {
      const res = await admin
        .from('group_members')
        .insert({ group_id: groupId, profile_id: who.id, role, manager_id: managerId })
        .select('id')
        .single();
      expect(res.error).toBeNull();
      return res.data!.id as string;
    };
    managerMemberId = await add(manager, 'manager', null);
    empMemberId = await add(employee, 'member', managerMemberId);
    otherMemberId = await add(other, 'member', null);

    // Make the accrual independent of the day the suite runs: everybody joined, and the types
    // started, on the 1st of this month, so each type has exactly one month (1 day) earned.
    const first = `${dayIso(0).slice(0, 8)}01T12:00:00Z`;
    await admin.from('group_members').update({ created_at: first }).eq('group_id', groupId);
    await admin
      .from('company_leave_types')
      .update({ starts_on: first.slice(0, 10) })
      .eq('group_id', groupId);

    managerCtx = await signInForm(browser, manager);
  });

  test.afterAll(async () => {
    await Promise.allSettled([ownerCtx?.close(), managerCtx?.close()]);
    // No data cleanup: activity_log is append-only, so a company can't be deleted. Unique emails per run.
  });

  test('a new company starts with Casual and Sick, and every member can read them', async () => {
    for (const who of [owner, manager, employee, other]) {
      const res = await (
        await apiFor(who)
      )
        .from('company_leave_types')
        .select('id,name,carry_forward,accrual_days_per_month');
      expect(res.error).toBeNull();
      const byName = Object.fromEntries((res.data ?? []).map((r) => [r.name, r]));
      expect(Object.keys(byName).sort()).toEqual(['Casual', 'Sick']);
      expect(Number(byName.Casual.accrual_days_per_month)).toBe(1);
      expect(byName.Casual.carry_forward).toBe(true);
      expect(byName.Sick.carry_forward).toBe(false);
      casualId = byName.Casual.id;
      sickId = byName.Sick.id;
    }
  });

  test('only the owner edits leave types', async () => {
    const edit = (who: Person, name: string, id = crypto.randomUUID()) =>
      apiFor(who).then((api) =>
        api.rpc('waves_company_leave_type_set', {
          p_group_id: groupId,
          p_id: id,
          p_name: name,
          p_accrual: 1.5,
          p_carry: true,
          p_carry_cap: 10,
          p_annual_cap: null,
          p_paid: true,
          p_allow_overdraw: false,
          p_active: true,
        }),
      );
    expect((await edit(employee, 'Employee made')).error).not.toBeNull();
    expect((await edit(manager, 'Manager made')).error).not.toBeNull();
    expect((await edit(employee, 'Hijack', sickId)).error).not.toBeNull();
    expect((await edit(owner, 'Earned')).error).toBeNull();
    const earned = await admin
      .from('company_leave_types')
      .select('accrual_days_per_month')
      .eq('group_id', groupId)
      .eq('name', 'Earned');
    expect(Number(earned.data?.[0]?.accrual_days_per_month)).toBe(1.5);
  });

  let sickRequest = '';
  test('employee requests 1 day Sick: the manager (not the owner) is told', async () => {
    expect(await balance(empMemberId, sickId)).toBe(1);
    sickRequest = await ask(employee, empMemberId, sickId, dayIso(0), dayIso(0));
    expect(await statusOf(sickRequest)).toBe('pending');
    expect(await balance(empMemberId, sickId)).toBe(1); // pending is not deducted
    await expect.poll(() => heard(manager.id, 'company_leave_requested')).toBe(1);
    expect(await heard(owner.id, 'company_leave_requested')).toBe(0);
  });

  test('manager approves on the web Pending screen: balance drops by 1, employee is told', async () => {
    const page = await managerCtx.newPage();
    await page.goto(`/c/${groupId}/pending`);
    await expect(page.getByRole('button', { name: /^approve$/i })).toHaveCount(1);
    await page.getByRole('button', { name: /^approve$/i }).click();
    await expect.poll(() => statusOf(sickRequest)).toBe('approved');
    expect(await balance(empMemberId, sickId)).toBe(0);
    expect(await balance(empMemberId, casualId)).toBe(1); // other types untouched
    await expect.poll(() => heard(employee.id, 'company_leave_approved')).toBe(1);
    await page.close();
  });

  test('a request beyond the balance is refused at approval', async () => {
    const tooMuch = await ask(employee, empMemberId, sickId, dayIso(-3), dayIso(-2));
    const refused = await decide(manager, tooMuch, true);
    expect(refused.error?.message ?? '').toMatch(/INSUFFICIENT_BALANCE/);
    expect((await decide(owner, tooMuch, true)).error).not.toBeNull(); // the owner too, unless overdraw is allowed
    expect(await statusOf(tooMuch)).toBe('pending');
    expect((await decide(manager, tooMuch, false)).error).toBeNull(); // rejecting is always fine
    expect(await balance(empMemberId, sickId)).toBe(0);
  });

  test('a manager cannot approve another team; the owner can', async () => {
    const theirs = await ask(other, otherMemberId, casualId, dayIso(0), dayIso(0));
    expect((await decide(manager, theirs, true)).error).not.toBeNull();
    expect(await statusOf(theirs)).toBe('pending');
    // No manager: every owner hears about it, the manager does not. The manager's 2 are their own
    // employee's earlier requests (the 1-day Sick and the over-balance one); this one adds none.
    expect(await heard(manager.id, 'company_leave_requested')).toBe(2);
    expect((await decide(owner, theirs, true)).error).toBeNull();
    expect(await balance(otherMemberId, casualId)).toBe(0);
  });

  test('an employee cannot request leave for someone else', async () => {
    const res = await (
      await apiFor(employee)
    ).rpc('waves_company_leave_set', {
      p_group_id: groupId,
      p_id: crypto.randomUUID(),
      p_member_id: otherMemberId,
      p_start: dayIso(1),
      p_end: dayIso(1),
      p_half: false,
      p_kind: 'other',
      p_reason: null,
      p_leave_type_id: casualId,
    });
    expect(res.error).not.toBeNull();
  });

  test.fixme('owner edits the leave policy in the web UI (the screen exists; this spec does not drive it yet)', async () => {});
  test.fixme('employee sees their balances per type on the web home (the card exists; this spec does not drive it yet)', async () => {});
});
