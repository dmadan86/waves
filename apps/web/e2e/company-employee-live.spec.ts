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
 * The company as an EMPLOYEE (role 'member') sees it, across real accounts, against a real
 * Supabase stack. Same setup and skip rule as company-money-live.spec.ts (read that first).
 *
 *   E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY / E2E_SUPABASE_SERVICE_KEY
 *
 * People (one browser context each, real sign-in form): owner, employee A, employee B.
 * B is the control: nothing meant for A may reach B.
 *
 * What the product has today (found while writing this):
 *  - Tasks: the owner/manager assigns (Team > Work > Add task, with optional photos). An employee
 *    sees only their own tasks and may change STATUS (+ note / blocked reason). An employee cannot
 *    add a task or attach a photo (web: canManage only; DB: the owner/manager assigns).
 *  - Payments to an employee (advance, wages, reimbursement) show on the employee's statement.
 *  - Events: an owner event can target chosen people; RLS hides it from everyone else.
 *  - NOTIFICATIONS: `public.notifications` (written by waves_notify, delivered by notify-fanout) has
 *    NO company writers for tasks, payments or events. The only company-adjacent rows are
 *    group_added / member_removed / ghost_claim_*. There is no in-app notification list on web
 *    (only /settings/notifications preferences). So those steps are test.fixme below.
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
const COMPANY = `E2E Employee Co ${stamp}`;
const TASK_A = `Fix the gate ${stamp}`;
const TASK_B = `Paint the wall ${stamp}`;
const EVENT = `Site meeting ${stamp}`;
const BLOCK_REASON = 'Waiting for cement';

/** "₹1,200" or "₹1,200.00", but never a prefix of a bigger number. */
const inr = (n: number) => new RegExp(`₹\\s?${n.toLocaleString('en-IN')}(\\.00)?(?![\\d,])`);

// Photo storage (R2) is configured on production only; set E2E_PHOTOS=1 when the target has it.
const photos = process.env.E2E_PHOTOS === '1';

// A 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

interface Person {
  id: string;
  email: string;
  name: string;
}

let admin: SupabaseClient;
let owner: Person;
let empA: Person;
let empB: Person;
let groupId = '';
let memberA = '';
let memberB = '';
let ownerCtx: BrowserContext;
let aCtx: BrowserContext;
let bCtx: BrowserContext;

async function makePerson(label: string, name: string): Promise<Person> {
  const email = `e2e-emp-${label}-${stamp}@example.com`;
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

async function apiAs(who: Person): Promise<SupabaseClient> {
  const api = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const signed = await api.auth.signInWithPassword({ email: who.email, password: PASSWORD });
  expect(signed.error).toBeNull();
  return api;
}

const taskRow = async (title: string) => {
  const { data, error } = await admin
    .from('company_work_tasks')
    .select('*')
    .eq('group_id', groupId)
    .eq('title', title)
    .is('deleted_at', null);
  expect(error).toBeNull();
  return (data ?? []) as Array<Record<string, any>>;
};
const taskStatus = async (title: string) => (await taskRow(title))[0]?.status;

/** Every notification row in this company, for one person. */
async function notificationsFor(who: Person) {
  const { data, error } = await admin
    .from('notifications')
    .select('kind, title, deep_link')
    .eq('group_id', groupId)
    .eq('profile_id', who.id);
  expect(error).toBeNull();
  return data ?? [];
}

async function saveEntry(page: Page, amount: string) {
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByText(/^✓/)).toBeVisible({ timeout: 30_000 });
}

async function addTask(page: Page, title: string, assignee: Person, photo?: boolean) {
  await page.goto(`/c/${groupId}/team?seg=work`);
  await page.getByRole('button', { name: 'Add task', exact: true }).first().click();
  await page.getByLabel('Task description').fill(title);
  await page.getByRole('group', { name: 'Assign to' }).getByLabel(assignee.name).check();
  if (photo) {
    await page.getByLabel('Attach photo (optional)').setInputFiles({
      name: 'proof.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
  }
  await page.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add task' })).toHaveCount(0);
  // Next.js keeps an empty route-announcer alert on every page; only a visible message counts.
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
}

/** Open the status panel for a task from the employee's own task list. */
async function openStatus(page: Page, title: string) {
  await page.goto(`/c/${groupId}/team?seg=work`);
  const done = page.getByRole('button', { name: /^Done · \d+$/ });
  const row = page.getByRole('button', { name: new RegExp(title) });
  await expect(row.or(done).first()).toBeVisible();
  if (!(await row.count())) await done.click();
  await row.first().click();
  await expect(
    page.getByRole('heading', { name: new RegExp(`^Update status: .*${title}`) }),
  ).toBeVisible();
}

test.describe.serial('company as an employee, one browser per person', () => {
  test.beforeAll(async ({ browser }) => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    owner = await makePerson('owner', 'Olivia Owner');
    empA = await makePerson('a', 'Ravi Employee');
    empB = await makePerson('b', 'Bala Control');

    ownerCtx = await signInForm(browser, owner);
    const page = await ownerCtx.newPage();
    await page.goto('/companies/new');
    await page.getByLabel('Company name').fill(COMPANY);
    await page.getByRole('button', { name: 'Create company' }).click();
    await page.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 30_000 });
    groupId = page.url().match(/\/c\/([0-9a-f-]{36})/)![1];
    await page.close();

    for (const [who, set] of [
      [empA, (id: string) => (memberA = id)],
      [empB, (id: string) => (memberB = id)],
    ] as const) {
      const added = await admin
        .from('group_members')
        .insert({ group_id: groupId, profile_id: who.id, role: 'member' })
        .select('id')
        .single();
      expect(added.error).toBeNull();
      set(added.data!.id);
    }

    aCtx = await signInForm(browser, empA);
    bCtx = await signInForm(browser, empB);
  });

  test.afterAll(async () => {
    await Promise.allSettled([ownerCtx?.close(), aCtx?.close(), bCtx?.close()]);
    // No data cleanup: activity_log is append-only, so a company can't be deleted. Unique emails per
    // run, as company-money-live.spec.ts does; run against staging only.
  });

  test('owner assigns A a task with a photo, and B a different task', async () => {
    const page = await ownerCtx.newPage();
    await addTask(page, TASK_A, empA, photos);
    await addTask(page, TASK_B, empB);
    await page.close();

    const [a] = await taskRow(TASK_A);
    expect([a.member_id, a.status]).toEqual([memberA, 'todo']);
    const [b] = await taskRow(TASK_B);
    expect([b.member_id, b.status]).toEqual([memberB, 'todo']);
  });

  test('A sees their task and the owner photo; B sees neither', async () => {
    const a = await aCtx.newPage();
    await openStatus(a, TASK_A);
    if (photos) {
      await expect(a.getByText('Photos', { exact: true })).toBeVisible();
      await expect(a.getByText('Photos 1', { exact: true })).toBeVisible();
    }
    await a.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(a.getByText(TASK_B)).toHaveCount(0);
    await a.close();

    const b = await bCtx.newPage();
    await b.goto(`/c/${groupId}/team?seg=work`);
    await expect(b.getByRole('button', { name: new RegExp(TASK_B) })).toBeVisible();
    await expect(b.getByText(TASK_A)).toHaveCount(0);
    await b.close();

    // Row-level security: B's API cannot read A's task.
    const api = await apiAs(empB);
    const tasks = await api.from('company_work_tasks').select('title');
    expect(tasks.error).toBeNull();
    expect(tasks.data!.map((t) => t.title)).toEqual([TASK_B]);
  });

  test('A moves the task to in progress, blocked (with a reason), then done', async () => {
    const page = await aCtx.newPage();

    await openStatus(page, TASK_A);
    await page.getByRole('button', { name: 'In progress', exact: true }).click();
    await expect.poll(() => taskStatus(TASK_A)).toBe('doing');

    await openStatus(page, TASK_A);
    await page.getByRole('button', { name: 'Blocked', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveText(
      'Why is it blocked?',
    );
    await page.getByLabel('Add a note (optional)').fill(BLOCK_REASON);
    await page.getByRole('button', { name: 'Blocked', exact: true }).click();
    await expect.poll(() => taskStatus(TASK_A)).toBe('blocked');
    expect((await taskRow(TASK_A))[0].blocked_reason).toBe(BLOCK_REASON);

    await openStatus(page, TASK_A);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect.poll(() => taskStatus(TASK_A)).toBe('done');
    const [row] = await taskRow(TASK_A);
    expect([row.blocked_reason, row.title, row.member_id]).toEqual([null, TASK_A, memberA]);
    await page.close();

    // B's task is untouched.
    expect(await taskStatus(TASK_B)).toBe('todo');
  });

  test('owner sees A finished the task', async () => {
    const page = await ownerCtx.newPage();
    await page.goto(`/c/${groupId}/team?seg=work`);
    await page.getByRole('button', { name: /^Done · \d+$/ }).click();
    const row = page.getByRole('button', { name: new RegExp(TASK_A) });
    await expect(row).toBeVisible();
    await expect(row.locator('xpath=..')).toContainText('Done');
    await page.close();
  });

  test('owner pays A an advance of 500 and wages of 20,000; A sees both on the statement', async () => {
    const page = await ownerCtx.newPage();
    await page.goto(`/c/${groupId}/entry/new?member=${memberA}`);
    await expect(page.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('advance');
    await saveEntry(page, '500');
    await page.goto(`/c/${groupId}/entry/new?member=${memberA}`);
    await page
      .getByRole('combobox', { name: 'Type', exact: true })
      .selectOption({ label: 'Wages paid' });
    await saveEntry(page, '20000');
    await page.close();

    const a = await aCtx.newPage();
    await a.goto(`/c/${groupId}/statement/${memberA}`);
    const card = a.locator('.card', { has: a.getByText('Balance', { exact: true }) }).first();
    await expect(card.locator('h2')).toContainText(inr(500));
    await expect(card).toContainText(/you have/i);
    await expect(a.getByText(/wages/i).first()).toBeVisible();
    await expect(a.getByText(inr(20000)).first()).toBeVisible();
    await a.close();
  });

  test('B cannot see any of A’s payments, on the page or through the API', async () => {
    const api = await apiAs(empB);
    const seen = await api.from('company_entries').select('id').eq('group_id', groupId);
    expect(seen.error).toBeNull();
    expect(seen.data).toEqual([]);

    const page = await bCtx.newPage();
    await page.goto(`/c/${groupId}/statement/${memberA}`);
    await expect(page.getByText(inr(20000))).toHaveCount(0);
    await expect(page.getByText(inr(500))).toHaveCount(0);
    await page.close();
  });

  test('owner creates a meeting for A only; A sees it, B does not', async () => {
    const page = await ownerCtx.newPage();
    await page.goto(`/c/${groupId}/calendar`);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Event', exact: true }).click();
    await page.getByLabel('Event title').fill(EVENT);
    await page.getByRole('checkbox', { name: empA.name }).check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByLabel('Event title')).toHaveCount(0);
    await page.close();

    const events = await admin
      .from('company_events')
      .select('people')
      .eq('group_id', groupId)
      .eq('title', EVENT)
      .is('deleted_at', null);
    expect(events.error).toBeNull();
    expect(events.data!.map((e) => e.people)).toEqual([[memberA]]);

    const a = await aCtx.newPage();
    await a.goto(`/c/${groupId}/calendar`);
    await expect(a.getByRole('button', { name: EVENT })).toBeVisible();
    await a.close();

    const b = await bCtx.newPage();
    await b.goto(`/c/${groupId}/calendar`);
    await expect(b.getByText(TASK_B).first()).toBeVisible();
    await expect(b.getByText(EVENT)).toHaveCount(0);
    await b.close();

    const api = await apiAs(empB);
    const hidden = await api.from('company_events').select('id').eq('group_id', groupId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
  });

  test('the control employee B is notified of nothing that was meant for A', async () => {
    // True today because no company flow notifies anyone (see the fixmes). Keeps guarding
    // recipient scoping once they do: B must never get a task, payment or event row of A's.
    expect(await notificationsFor(empB)).toEqual([]);
  });

  test.fixme('A is notified when the owner assigns them a task', async () => {
    // No writer: waves_company_work_set never calls waves_notify, so no notifications row exists.
    // When it ships: expect(await notificationsFor(empA)) to include a task-assigned kind.
  });

  test.fixme('A is notified of an advance, wages or a reimbursement paid to them', async () => {
    // No writer: company entry RPCs are "outside activity, notifications and realtime"
    // (company_expenses migration header). The statement is the only place A learns of a payment.
  });

  test.fixme('A is notified of an event the owner creates for them', async () => {
    // No writer: waves_company_event_set only stamps updated_at; nothing is queued for `people`.
  });

  test.fixme('owner is notified when A changes a task status or marks it blocked', async () => {
    // No writer: status changes produce no notifications row for the owner or manager.
  });

  test.fixme('A sees company notifications in an in-app list on web', async () => {
    // Web has only /settings/notifications (preferences); there is no inbox or bell to open.
  });

  test.fixme('A adds their own task', async () => {
    // Web offers "Add task" only when canManage; the DB also limits an employee to moving the
    // status/note of a task someone assigned them (company-scenario-tasks.test.ts G24).
  });

  test.fixme('A uploads a completion photo to their task ("complete your upload")', async () => {
    // Web: task photos can only be attached in the owner/manager Add task form; the employee's
    // status panel lists photos read-only (Photos canRemove=false, no file input).
  });

  test.fixme('A requests a payment from the company', async () => {
    // Web has no request-payment screen; the nearest thing is the expense claim, covered end to end
    // in company-money-live.spec.ts. (The phone has an employee-to-company direction on company-entry.)
  });
});
