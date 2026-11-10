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
 * The OWNER's day across DIFFERENT real accounts, against a real Supabase stack: assign tasks,
 * mark attendance, record payments, read each person's statement. Same setup as
 * company-money-live.spec.ts (which covers advance/wages/claim/reimburse and a part-paid bill:
 * not repeated here). Needs E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY / E2E_SUPABASE_SERVICE_KEY;
 * without them the file is skipped.
 *
 * People: owner; manager; Ravi (managed by the manager via manager_id); Esha (no manager);
 * Asha (member only, never signs in). Ravi and Esha get a browser each.
 *
 * What the product does today, which the steps below follow:
 *  - Tasks go to EMPLOYEES only (waves_company_work_set allows role 'member' for a plain task);
 *    a manager cannot be the responsible person, so that step is test.fixme.
 *  - The add-task form has no time field; the time is set from the edit form.
 *  - Attendance lists employees only, and cannot be marked for a future day.
 *  - The statement lists entries by date then creation time; it has no running-balance column,
 *    only the closing balance card.
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
const COMPANY = `E2E Owner Co ${stamp}`;

/** "₹1,200" or "₹1,200.00", but never a prefix of a bigger number. */
const inr = (n: number) => new RegExp(`₹\\s?${n.toLocaleString('en-IN')}(\\.00)?(?![\\d,])`);

/** The app's own "today": the browser's local date (todayIso in lib/company/view.ts). */
const localIso = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const today = localIso();
const yesterday = localIso(-1);

interface Person {
  id: string;
  email: string;
  name: string;
}

let admin: SupabaseClient;
let owner: Person;
let manager: Person;
let ravi: Person;
let esha: Person;
let asha: Person;
let groupId = '';
let ownerMemberId = '';
let managerMemberId = '';
const memberOf: Record<string, string> = {};
let ownerCtx: BrowserContext;
let raviCtx: BrowserContext;
let eshaCtx: BrowserContext;

async function makePerson(label: string, name: string): Promise<Person> {
  const email = `e2e-owner-${label}-${stamp}@example.com`;
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

async function addMember(who: Person, role: 'manager' | 'member', managerId: string | null) {
  const added = await admin
    .from('group_members')
    .insert({ group_id: groupId, profile_id: who.id, role, manager_id: managerId })
    .select('id')
    .single();
  expect(added.error).toBeNull();
  memberOf[who.id] = added.data!.id;
  return added.data!.id as string;
}

/** A user-scoped API client, so Row Level Security applies as it does in the app. */
async function apiAs(who: Person): Promise<SupabaseClient> {
  const api = createClient(url!, anonKey!, { auth: { persistSession: false } });
  expect(
    (await api.auth.signInWithPassword({ email: who.email, password: PASSWORD })).error,
  ).toBeNull();
  return api;
}

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
const entriesOf = async (who: Person, kind: string) =>
  (await entries()).filter((e) => e.entry_kind === kind && e.member_id === memberOf[who.id]);

async function tasks() {
  const { data, error } = await admin
    .from('company_work_tasks')
    .select('*')
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('created_at');
  expect(error).toBeNull();
  return (data ?? []) as Array<Record<string, any>>;
}
const taskTitled = async (title: string) => (await tasks()).filter((t) => t.title === title);

/** Live attendance rows for one day; call the result with a person to get their mark. */
async function marksOn(day: string) {
  const { data, error } = await admin
    .from('company_attendance')
    .select('member_id, status, marked_by')
    .eq('group_id', groupId)
    .eq('day', day)
    .is('deleted_at', null);
  expect(error).toBeNull();
  const byMember = new Map((data ?? []).map((r) => [r.member_id as string, r]));
  return (who: Person) => byMember.get(memberOf[who.id]);
}

async function saveEntry(page: Page, amount: string) {
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByText(/^✓/)).toBeVisible({ timeout: 30_000 });
}

async function addTask(page: Page, title: string, assignees: string[]) {
  await page.goto(`/c/${groupId}/team?seg=work`);
  await page.getByRole('button', { name: 'Add task' }).first().click();
  await page.getByLabel('Task description').fill(title);
  const assign = page.getByRole('group', { name: 'Assign to' });
  for (const name of assignees) await assign.getByLabel(name).check();
  await page.getByRole('button', { name: 'Save task' }).click();
  await expect(page.getByLabel('Task description')).toHaveCount(0);
}

const taskRow = (page: Page, title: string) => page.locator('.card.row', { hasText: title });
const attendanceRow = (page: Page, name: string) =>
  page.locator('.card > div').filter({ hasText: name });
const statementRows = (page: Page) => page.locator('li:has(a[href*="/entry/"])');

test.describe.serial('company owner, one browser per person', () => {
  test.beforeAll(async ({ browser }) => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    owner = await makePerson('owner', 'Olivia Owner');
    manager = await makePerson('mgr', 'Mira Manager');
    ravi = await makePerson('ravi', 'Ravi Employee');
    esha = await makePerson('esha', 'Esha Employee');
    asha = await makePerson('asha', 'Asha Employee');

    ownerCtx = await signInForm(browser, owner);
    const page = await ownerCtx.newPage();
    await page.goto('/companies/new');
    await page.getByLabel('Company name').fill(COMPANY);
    await page.getByRole('button', { name: 'Create company' }).click();
    await page.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 30_000 });
    groupId = page.url().match(/\/c\/([0-9a-f-]{36})/)![1];
    await page.close();

    const me = await admin
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('profile_id', owner.id)
      .single();
    expect(me.error).toBeNull();
    ownerMemberId = me.data!.id;
    memberOf[owner.id] = ownerMemberId;

    managerMemberId = await addMember(manager, 'manager', null);
    await addMember(ravi, 'member', managerMemberId);
    await addMember(esha, 'member', null);
    await addMember(asha, 'member', null);

    raviCtx = await signInForm(browser, ravi);
    eshaCtx = await signInForm(browser, esha);
  });

  test.afterAll(async () => {
    await Promise.allSettled([ownerCtx?.close(), raviCtx?.close(), eshaCtx?.close()]);
    // No data cleanup: activity_log is append-only, so a company can't be deleted, even by the
    // service role. Each run uses unique emails; run against staging only.
  });

  test('owner assigns tasks directly to employees, one and many at once', async () => {
    const page = await ownerCtx.newPage();
    await addTask(page, 'Fix the gate', [ravi.name]);
    await addTask(page, 'Paint the wall', [esha.name]);
    await addTask(page, 'Sweep the floor', [ravi.name, esha.name]);
    await page.close();

    const shape = async (title: string) =>
      (await taskTitled(title)).map((t) => [t.member_id, t.status, t.day, t.created_by]).sort();
    expect(await shape('Fix the gate')).toEqual([
      [memberOf[ravi.id], 'todo', today, ownerMemberId],
    ]);
    expect(await shape('Paint the wall')).toEqual([
      [memberOf[esha.id], 'todo', today, ownerMemberId],
    ]);
    // Two people ticked: one task each, not one shared task.
    expect(await shape('Sweep the floor')).toEqual(
      [
        [memberOf[ravi.id], 'todo', today, ownerMemberId],
        [memberOf[esha.id], 'todo', today, ownerMemberId],
      ].sort(),
    );
  });

  test.fixme('owner assigns a task to the manager', async () => {
    // Not supported: the Assign-to list is employees only (useWorkdayAccess.people keeps role
    // 'member'), and waves_company_work_set rejects a manager as the responsible person unless
    // the task is a client follow-up. Enable when managers can own tasks.
  });

  test('each employee sees only their own tasks, in their own browser and through RLS', async () => {
    const r = await raviCtx.newPage();
    await r.goto(`/c/${groupId}/team?seg=work`);
    await expect(taskRow(r, 'Fix the gate')).toBeVisible();
    await expect(taskRow(r, 'Sweep the floor')).toBeVisible();
    await expect(r.getByText('Paint the wall')).toHaveCount(0);
    await r.close();

    const e = await eshaCtx.newPage();
    await e.goto(`/c/${groupId}/team?seg=work`);
    await expect(taskRow(e, 'Paint the wall')).toBeVisible();
    await expect(taskRow(e, 'Sweep the floor')).toBeVisible();
    await expect(e.getByText('Fix the gate')).toHaveCount(0);
    await e.close();

    const titlesFor = async (who: Person) => {
      const res = await (await apiAs(who)).from('company_work_tasks').select('title');
      expect(res.error).toBeNull();
      return res.data!.map((t) => t.title).sort();
    };
    expect(await titlesFor(ravi)).toEqual(['Fix the gate', 'Sweep the floor']);
    expect(await titlesFor(esha)).toEqual(['Paint the wall', 'Sweep the floor']);
    // Unassigned employee: nothing at all.
    expect(await titlesFor(asha)).toEqual([]);
  });

  test('the employee marks a task done and the owner sees the new status', async () => {
    const r = await raviCtx.newPage();
    await r.goto(`/c/${groupId}/team?seg=work`);
    // The box is controlled by the saved status, so it flips only after the save: click, then poll.
    await taskRow(r, 'Fix the gate').getByRole('checkbox', { name: 'Done' }).click();
    await expect.poll(async () => (await taskTitled('Fix the gate'))[0]?.status).toBe('done');
    await r.close();

    const o = await ownerCtx.newPage();
    await o.goto(`/c/${groupId}/team?seg=work`);
    await expect(taskRow(o, 'Fix the gate')).toContainText('Done');
    // Esha's task is untouched.
    await expect(taskRow(o, 'Paint the wall')).toContainText('To do');
    await o.close();
  });

  test('a task with a due time (set from the edit form) shows the time', async () => {
    const o = await ownerCtx.newPage();
    await o.goto(`/c/${groupId}/team?seg=work`);
    await taskRow(o, 'Paint the wall')
      .getByRole('button', { name: /Paint the wall/ })
      .click();
    await o.getByLabel('Time', { exact: true }).fill('10:30');
    await o.getByRole('button', { name: 'Save task' }).click();
    await expect
      .poll(async () => String((await taskTitled('Paint the wall'))[0]?.due_time ?? ''))
      .toMatch(/^10:30/);
    await expect(taskRow(o, 'Paint the wall')).toContainText('10:30');
    await o.close();
  });

  test('an overdue task sits under Overdue, for its assignee and not for others', async () => {
    // The add form refuses a past day (min = today), so the row is seeded as the server allows
    // (waves_company_work_set accepts up to 400 days back).
    const seeded = await admin.from('company_work_tasks').insert({
      group_id: groupId,
      member_id: memberOf[ravi.id],
      day: yesterday,
      title: 'Check the pump',
      status: 'todo',
      created_by: ownerMemberId,
    });
    expect(seeded.error).toBeNull();

    const o = await ownerCtx.newPage();
    await o.goto(`/c/${groupId}/team?seg=work`);
    await expect(o.getByRole('heading', { name: 'Overdue · 1' })).toBeVisible();
    await expect(taskRow(o, 'Check the pump')).toContainText(`Late · ${yesterday}`);
    await o.close();

    const r = await raviCtx.newPage();
    await r.goto(`/c/${groupId}/team?seg=work`);
    await expect(r.getByRole('heading', { name: 'Overdue · 1' })).toBeVisible();
    await r.close();

    const e = await eshaCtx.newPage();
    await e.goto(`/c/${groupId}/team?seg=work`);
    await expect(taskRow(e, 'Sweep the floor')).toBeVisible();
    await expect(e.getByText('Check the pump')).toHaveCount(0);
    await expect(e.getByRole('heading', { name: /^Overdue/ })).toHaveCount(0);
    await e.close();
  });

  test('Team > People counts open tasks (today + overdue) per employee', async () => {
    // Expected counts come from the tasks this spec created: not done, dated today or earlier.
    const all = await tasks();
    const open = (who: Person) =>
      all.filter((t) => t.member_id === memberOf[who.id] && t.status !== 'done' && t.day <= today)
        .length;
    // Ravi: Sweep (today) + the overdue pump; Fix the gate is done. Esha: Paint the wall + Sweep.
    expect([open(ravi), open(esha)]).toEqual([2, 2]);

    const o = await ownerCtx.newPage();
    await o.goto(`/c/${groupId}/team?seg=people`);
    await expect(o.getByRole('link', { name: /Ravi Employee/ })).toContainText(
      `${open(ravi)} open tasks`,
    );
    await expect(o.getByRole('link', { name: /Esha Employee/ })).toContainText(
      `${open(esha)} open tasks`,
    );
    await o.close();
  });

  test.fixme('an overdue task is counted on Team / Overview', async () => {
    // People rows count only tasks dated today (openTasksToday), and the Overview shows no
    // overdue figure (useWorkdayCounts only has blocked + unmarked, and nothing renders it).
    // The only overdue signal is the "Overdue · N" heading under Team > Tasks, asserted above.
  });

  test('owner marks present, half day and absent; summary and grid are exact', async () => {
    const o = await ownerCtx.newPage();
    await o.goto(`/c/${groupId}/team?seg=attendance`);

    // The manager is not an employee: no row to mark.
    await expect(attendanceRow(o, 'Ravi Employee')).toHaveCount(1);
    await expect(attendanceRow(o, 'Mira Manager')).toHaveCount(0);

    await attendanceRow(o, 'Ravi Employee')
      .getByRole('button', { name: 'Present', exact: true })
      .click();
    await attendanceRow(o, 'Asha Employee')
      .getByRole('button', { name: 'Absent', exact: true })
      .click();
    // Half day lives in the picker.
    const esh = attendanceRow(o, 'Esha Employee');
    await esh.getByRole('button', { name: /^Mark\.\.\.$/ }).click();
    await esh.getByRole('button', { name: 'Half day', exact: true }).click();
    await esh.getByRole('button', { name: 'Save', exact: true }).click();

    await expect
      .poll(async () => {
        const m = await marksOn(today);
        return [m(ravi)?.status, m(esha)?.status, m(asha)?.status];
      })
      .toEqual(['present', 'half', 'absent']);
    const m = await marksOn(today);
    expect([m(ravi)?.marked_by, m(esha)?.marked_by, m(asha)?.marked_by]).toEqual(
      Array(3).fill(ownerMemberId),
    );

    // Filter summary: "Present" counts half days too (as the Overview does), so 2; absent 1; none unmarked.
    const status = o.getByRole('combobox', { name: 'Status' });
    await status.selectOption('present');
    await expect(o.locator('.card > div')).toHaveCount(2);
    await status.selectOption('absent');
    await expect(o.locator('.card > div')).toHaveCount(1);
    await expect(attendanceRow(o, 'Asha Employee')).toHaveCount(1);
    await status.selectOption('unmarked');
    await expect(o.getByText('No one matches.')).toBeVisible();
    await status.selectOption('');

    // Weekly grid: one P, one half, one A in today's column, each on the right row.
    await o.getByRole('button', { name: 'Weekly', exact: true }).click();
    const cellOf = (name: string, mark: string) =>
      o
        .locator('tbody tr', { hasText: name })
        .locator('td')
        .filter({ hasText: new RegExp(`^${mark}$`) });
    await expect(cellOf('Ravi Employee', 'P')).toHaveCount(1);
    await expect(cellOf('Esha Employee', '½')).toHaveCount(1);
    await expect(cellOf('Asha Employee', 'A')).toHaveCount(1);
    await o.close();
  });

  test("Team > People shows today's mark next to each employee", async () => {
    const o = await ownerCtx.newPage();
    await o.goto(`/c/${groupId}/team?seg=people`);
    await expect(o.getByRole('link', { name: /Ravi Employee/ })).toContainText('Present');
    await expect(o.getByRole('link', { name: /Asha Employee/ })).toContainText('Absent');
    await o.close();
  });

  test('an employee sees their own mark in My attendance, and not other people', async () => {
    const r = await raviCtx.newPage();
    await r.goto(`/c/${groupId}/team?seg=attendance`);
    await expect(r.getByRole('heading', { name: 'My attendance' })).toBeVisible();
    const row = r.locator('tbody tr');
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').filter({ hasText: /^P$/ })).toHaveCount(1);
    await expect(r.getByText('Esha Employee')).toHaveCount(0);
    await r.close();

    const e = await eshaCtx.newPage();
    await e.goto(`/c/${groupId}/team?seg=attendance`);
    await expect(e.locator('tbody tr td').filter({ hasText: /^½$/ })).toHaveCount(1);
    await e.close();
  });

  test('edge: a past day can be marked, overwritten and cleared; the future cannot', async () => {
    const o = await ownerCtx.newPage();
    await o.goto(`/c/${groupId}/team?seg=attendance`);
    await o.locator('input[type=date]').fill(yesterday);
    const esh = attendanceRow(o, 'Esha Employee');

    await esh.getByRole('button', { name: 'Absent', exact: true }).click();
    await expect.poll(async () => (await marksOn(yesterday))(esha)?.status).toBe('absent');
    // Overwrite with Present (a changed mind, not a second row).
    await esh.getByRole('button', { name: 'Present', exact: true }).click();
    await expect.poll(async () => (await marksOn(yesterday))(esha)?.status).toBe('present');
    // Clear from the picker.
    await esh.getByRole('button', { name: /^Present\.\.\.$/ }).click();
    await esh.getByRole('button', { name: 'Clear', exact: true }).click();
    await esh.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await marksOn(yesterday))(esha)).toBeUndefined();
    // Today's marks were not touched.
    expect((await marksOn(today))(esha)?.status).toBe('half');

    // The date box is capped at today.
    expect(await o.locator('input[type=date]').getAttribute('max')).toBe(today);
    await o.close();
  });

  test('owner records two advances and wages; Payments lists them with exact amounts', async () => {
    const page = await ownerCtx.newPage();
    for (const amount of ['800', '450']) {
      await page.goto(`/c/${groupId}/entry/new?kind=advance&member=${memberOf[ravi.id]}`);
      await expect(page.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue(
        'advance',
      );
      await saveEntry(page, amount);
    }
    await page.goto(`/c/${groupId}/entry/new?member=${memberOf[esha.id]}`);
    await page
      .getByRole('combobox', { name: 'Type', exact: true })
      .selectOption({ label: 'Wages paid' });
    await saveEntry(page, '9000');

    expect((await entriesOf(ravi, 'advance')).map((e) => Number(e.amount))).toEqual([80000, 45000]);
    expect((await entriesOf(esha, 'wages')).map((e) => Number(e.amount))).toEqual([900000]);

    await page.goto(`/c/${groupId}/payments`);
    const item = (name: string, amount: number) =>
      page
        .locator('.item')
        .filter({ hasText: name })
        .filter({ hasText: inr(amount) });
    await expect(item('Ravi Employee', 800)).toHaveCount(1);
    await expect(item('Ravi Employee', 450)).toHaveCount(1);
    await expect(item('Esha Employee', 9000)).toHaveCount(1);
    await page.close();
  });

  test("owner reads Ravi's statement: advances in order, balance is their sum", async () => {
    const page = await ownerCtx.newPage();
    await page.goto(`/c/${groupId}/statement/${memberOf[ravi.id]}`);
    await expect(page.getByRole('heading', { name: 'Statement: Ravi Employee' })).toBeVisible();
    const card = page.locator('.card', { has: page.getByText('Balance', { exact: true }) }).first();
    await expect(card.locator('h2')).toContainText(inr(1250));
    await expect(statementRows(page)).toHaveCount(2);
    await expect(statementRows(page).nth(0)).toContainText(inr(800));
    await expect(statementRows(page).nth(1)).toContainText(inr(450));
    await page.close();
  });

  test('the employee sees the same statement, and nobody else can open it', async () => {
    const r = await raviCtx.newPage();
    await r.goto(`/c/${groupId}/statement/${memberOf[ravi.id]}`);
    await expect(r.getByRole('heading', { name: 'My statement' })).toBeVisible();
    await expect(statementRows(r)).toHaveCount(2);
    await expect(statementRows(r).nth(0)).toContainText(inr(800));
    await expect(statementRows(r).nth(1)).toContainText(inr(450));
    await r.close();

    // Esha: her wages only, and Ravi's statement is "No one found".
    const e = await eshaCtx.newPage();
    await e.goto(`/c/${groupId}/statement/${memberOf[esha.id]}`);
    await expect(statementRows(e)).toHaveCount(1);
    await expect(statementRows(e).first()).toContainText(inr(9000));
    await e.goto(`/c/${groupId}/statement/${memberOf[ravi.id]}`);
    await expect(e.getByText('No one found.')).toBeVisible();
    await e.close();

    const seen = await (await apiAs(esha)).from('company_entries').select('amount');
    expect(seen.error).toBeNull();
    expect(seen.data!.map((r) => Number(r.amount))).toEqual([900000]);
  });

  test('edge: editing an advance changes the statement; removing it takes it out', async () => {
    const [, second] = await entriesOf(ravi, 'advance');
    const o = await ownerCtx.newPage();

    await o.goto(`/c/${groupId}/entry/${second.id}/edit`);
    await o.getByLabel(/^Amount/).fill('400');
    await o.getByRole('button', { name: /^save$/i }).click();
    await o.waitForURL(new RegExp(`/entry/${second.id}$`), { timeout: 30_000 });
    await expect
      .poll(async () => (await entriesOf(ravi, 'advance')).map((e) => Number(e.amount)))
      .toEqual([80000, 40000]);

    await o.goto(`/c/${groupId}/statement/${memberOf[ravi.id]}`);
    await expect(o.locator('.card h2').first()).toContainText(inr(1200));
    await expect(statementRows(o).nth(1)).toContainText(inr(400));

    await o.goto(`/c/${groupId}/entry/${second.id}`);
    o.once('dialog', (d) => void d.accept());
    await o.getByRole('button', { name: 'Remove entry' }).click();
    await expect
      .poll(async () => (await entriesOf(ravi, 'advance')).map((e) => Number(e.amount)))
      .toEqual([80000]);

    await o.goto(`/c/${groupId}/statement/${memberOf[ravi.id]}`);
    await expect(o.locator('.card h2').first()).toContainText(inr(800));
    await expect(statementRows(o)).toHaveCount(1);
    await o.close();
  });

  test.fixme('statement shows a running balance after each entry', async () => {
    // The statement page has only the closing balance card (companyStatement.closing); rows
    // carry amount, label, note and date, with no per-row running balance. Enable if one ships.
  });
});
