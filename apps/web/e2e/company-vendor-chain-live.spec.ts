import { randomUUID } from 'node:crypto';

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
 * Company vendors, and a vendor chain across REAL accounts, against a real Supabase stack.
 *
 * Needs the migrations applied, the `sync` and `invite-accept` edge functions served, and:
 *   E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY / E2E_SUPABASE_SERVICE_KEY
 * Without them the whole file is skipped. Same pattern as company-money-live.spec.ts.
 *
 * How vendors work in the product:
 *  - A vendor is a RECORD (company_vendors), not a login. The owner (or the manager who added it)
 *    creates it; it has a ledger (company_vendor_entries: bill / payment / advance), orders
 *    (company_vendor_orders) and a bank/contact card (company_vendor_details).
 *  - A real account becomes that vendor's LOGIN by accepting a single-use invite link
 *    (waves_company_vendor_invite -> invite-accept -> group_members.role = 'vendor' and
 *    company_vendors.member_id). That is per company: the same account can own another company.
 *  - A vendor login sees only its own vendor row, ledger, orders and card (RLS through
 *    waves_company_vendor_visible). It may add a PENDING bill (counts once the owner confirms),
 *    withdraw its own pending bill, accept / reject / deliver orders, mark payments received and
 *    edit its own card. It cannot record payments, create orders, edit or remove the vendor, or
 *    review bills.
 *  - There is no link between companies: "B is a vendor in A" and "C is a vendor in B" are two
 *    independent vendor records in two independent companies that happen to share account B.
 *
 * Chain (INR):
 *   Company A (owner Alice) buys from B (Bhavana, vendor in A). Order 10 x 400 = 4,000.
 *     B bills 10,000 (pending until confirmed), A pays 4,000 + 1,500 -> A owes B 4,500.
 *   Company B (owner Bhavana) buys from C (Chandra, vendor in B). Order 5 x 1,000 = 5,000.
 *     C bills 5,000, B pays 2,000 -> B owes C 3,000.
 *   Esha is an employee of A (control): she must see no vendor data at all.
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
const COMPANY_A = `E2E Vendor A ${stamp}`;
const COMPANY_B = `E2E Vendor B ${stamp}`;
const VENDOR_B_IN_A = `Bhavana Traders ${stamp}`;
const VENDOR_RIVAL = `Rival Stores ${stamp}`;
const VENDOR_C_IN_B = `Chandra Steel ${stamp}`;

/** "₹4,500" or "₹4,500.00", but never a prefix of a bigger number. */
const inr = (n: number) => new RegExp(`₹\\s?${n.toLocaleString('en-IN')}(\\.00)?(?![\\d,])`);

interface Person {
  id: string;
  email: string;
  name: string;
}

let admin: SupabaseClient;
let alice: Person; // owns Company A
let bhavana: Person; // vendor in A, owns Company B
let chandra: Person; // vendor in B
let esha: Person; // employee of A
let apiA: SupabaseClient;
let apiB: SupabaseClient;
let apiC: SupabaseClient;
let apiE: SupabaseClient;
let ctxA: BrowserContext;
let ctxB: BrowserContext;
let ctxC: BrowserContext;
let ctxE: BrowserContext;
let groupA = '';
let groupB = '';
let eshaMemberId = '';
let vendorBInA = ''; // company_vendors.id of Bhavana in A
let vendorCInB = ''; // company_vendors.id of Chandra in B
let orderAB = ''; // A's order to B
let orderBC = ''; // B's order to C

async function makePerson(label: string, name: string): Promise<Person> {
  const email = `e2e-vendor-${label}-${stamp}@example.com`;
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

async function apiFor(who: Person): Promise<SupabaseClient> {
  const api = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const signed = await api.auth.signInWithPassword({ email: who.email, password: PASSWORD });
  expect(signed.error).toBeNull();
  return api;
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

async function createCompany(ctx: BrowserContext, name: string): Promise<string> {
  const page = await ctx.newPage();
  await page.goto('/companies/new');
  await page.getByLabel('Company name').fill(name);
  await page.getByRole('button', { name: 'Create company' }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const id = page.url().match(/\/c\/([0-9a-f-]{36})/)![1];
  await page.close();
  return id;
}

/** Every live ledger line of a vendor, oldest first. */
async function lines(vendorId: string) {
  const { data, error } = await admin
    .from('company_vendor_entries')
    .select('*')
    .eq('vendor_id', vendorId)
    .is('deleted_at', null)
    .order('created_at');
  expect(error).toBeNull();
  return (data ?? []) as Array<Record<string, any>>;
}
/** What the company owes the vendor, in minor units: confirmed bills less payments and advances. */
const owed = async (vendorId: string) =>
  (await lines(vendorId))
    .filter((l) => l.status === 'approved')
    .reduce((sum, l) => sum + (l.kind === 'bill' ? 1 : -1) * Number(l.amount), 0);

const orderStatus = async (orderId: string) =>
  (await admin.from('company_vendor_orders').select('status').eq('id', orderId).single()).data
    ?.status;

async function vendorRow(groupId: string, name: string) {
  const { data } = await admin
    .from('company_vendors')
    .select('*')
    .eq('group_id', groupId)
    .eq('name', name)
    .is('deleted_at', null);
  return (data ?? [])[0] as Record<string, any> | undefined;
}
async function memberOf(groupId: string, profileId: string) {
  const { data, error } = await admin
    .from('group_members')
    .select('id, role, left_at')
    .eq('group_id', groupId)
    .eq('profile_id', profileId);
  expect(error).toBeNull();
  return (data ?? [])[0] as { id: string; role: string; left_at: string | null } | undefined;
}

/** Live rows the caller can read (RLS decides), without the voided ones. */
async function visible(api: SupabaseClient, table: string) {
  const res = await api.from(table).select('id, group_id').is('deleted_at', null);
  expect(res.error, table).toBeNull();
  return res.data ?? [];
}

/** Owner adds a vendor through the real "Add vendor" form; returns the vendor id. */
async function addVendorViaForm(ctx: BrowserContext, groupId: string, name: string, phone: string) {
  const page = await ctx.newPage();
  await page.goto(`/c/${groupId}/vendors/new`);
  await page.getByLabel(/^Name \*/).fill(name);
  await page.getByLabel(/^Phone number/).fill(phone);
  await page.getByRole('button', { name: 'Save Vendor' }).click();
  await page.waitForURL(new RegExp(`/c/${groupId}/vendors/[0-9a-f-]{36}$`), { timeout: 30_000 });
  await page.close();
  await expect.poll(async () => (await vendorRow(groupId, name))?.id).toBeTruthy();
  return (await vendorRow(groupId, name))!.id as string;
}

/** Owner sends an order through the real form; returns the order id. */
async function sendOrderViaForm(
  ctx: BrowserContext,
  groupId: string,
  vendorId: string,
  item: string,
  qty: string,
  price: string,
) {
  const page = await ctx.newPage();
  await page.goto(`/c/${groupId}/vendors/${vendorId}/orders/new`);
  await page.getByLabel('Item', { exact: true }).fill(item);
  await page.getByLabel('Qty', { exact: true }).fill(qty);
  await page.getByLabel('Price / unit', { exact: true }).fill(price);
  await page.getByRole('button', { name: 'Send order' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const id = page.url().match(/\/orders\/([0-9a-f-]{36})$/)![1];
  await page.close();
  return id;
}

/** Owner records a cash payment through the real form. */
async function payViaForm(ctx: BrowserContext, groupId: string, vendorId: string, amount: string) {
  const page = await ctx.newPage();
  await page.goto(`/c/${groupId}/vendors/${vendorId}/pay`);
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await page.waitForURL(/\/receipt\//, { timeout: 30_000 });
  await page.close();
}

/** A vendor login submits a bill from its own home screen (it stays pending). */
async function vendorBillViaForm(ctx: BrowserContext, groupId: string, amount: string) {
  const page = await ctx.newPage();
  await page.goto(`/c/${groupId}/vendors`);
  await page.getByRole('button', { name: 'Add bill' }).click();
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Add bill' }).last().click();
  await expect(page.getByText('Pending').first()).toBeVisible();
  await page.close();
}

async function saveEntry(page: Page, amount: string) {
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByText(/^✓/)).toBeVisible({ timeout: 30_000 });
}

const refused = (res: { error: unknown }) => expect(res.error).not.toBeNull();
const today = () => new Date().toISOString().slice(0, 10);

test.describe.serial('company vendors and a vendor chain, one browser per person', () => {
  test.beforeAll(async ({ browser }) => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    alice = await makePerson('alice', 'Alice Owner');
    bhavana = await makePerson('bhavana', 'Bhavana Vendor');
    chandra = await makePerson('chandra', 'Chandra Vendor');
    esha = await makePerson('esha', 'Esha Employee');

    ctxA = await signInForm(browser, alice);
    ctxB = await signInForm(browser, bhavana);
    ctxC = await signInForm(browser, chandra);
    ctxE = await signInForm(browser, esha);
    groupA = await createCompany(ctxA, COMPANY_A);
    groupB = await createCompany(ctxB, COMPANY_B);

    const added = await admin
      .from('group_members')
      .insert({ group_id: groupA, profile_id: esha.id, role: 'member' })
      .select('id')
      .single();
    expect(added.error).toBeNull();
    eshaMemberId = added.data!.id;

    [apiA, apiB, apiC, apiE] = await Promise.all([
      apiFor(alice),
      apiFor(bhavana),
      apiFor(chandra),
      apiFor(esha),
    ]);
  });

  test.afterAll(async () => {
    await Promise.allSettled([ctxA?.close(), ctxB?.close(), ctxC?.close(), ctxE?.close()]);
    // No data cleanup: activity_log is append-only, so a company can't be deleted, even by the
    // service role. Each run uses unique emails; run against staging only.
  });

  test('owner A adds a vendor, gives it categories and a bank card', async () => {
    vendorBInA = await addVendorViaForm(ctxA, groupA, VENDOR_B_IN_A, '9876543210');
    const row = (await vendorRow(groupA, VENDOR_B_IN_A))!;
    expect(row.phone).toBe('9876543210');
    expect(row.member_id).toBeNull(); // a record only, no login yet
    expect(row.added_by).toBe((await memberOf(groupA, alice.id))!.id);

    // Categories: several, with `category` kept as the first.
    const set = await apiA.rpc('waves_company_vendor_set', {
      p_group_id: groupA,
      p_vendor_id: vendorBInA,
      p_data: { name: VENDOR_B_IN_A, phone: '9876543210', categories: ['Materials', 'Cement'] },
    });
    expect(set.error).toBeNull();
    const after = (await vendorRow(groupA, VENDOR_B_IN_A))!;
    expect(after.category).toBe('Materials');
    expect(after.categories).toEqual(['Materials', 'Cement']);
    // Duplicate (case-insensitive) categories are refused.
    refused(
      await apiA.rpc('waves_company_vendor_set', {
        p_group_id: groupA,
        p_vendor_id: vendorBInA,
        p_data: { name: VENDOR_B_IN_A, categories: ['Cement', 'cement'] },
      }),
    );

    // Bank details of the vendor.
    const card = await apiA.rpc('waves_company_vendor_details_set', {
      p_group_id: groupA,
      p_vendor_id: vendorBInA,
      p_data: { bankName: 'State Bank', bankAccount: '123456789012', ifsc: 'SBIN0001234' },
    });
    expect(card.error).toBeNull();
    const stored = await admin
      .from('company_vendor_details')
      .select('bank_name, bank_account, ifsc')
      .eq('vendor_id', vendorBInA)
      .single();
    expect(stored.data).toEqual({
      bank_name: 'State Bank',
      bank_account: '123456789012',
      ifsc: 'SBIN0001234',
    });
    // A malformed IFSC is refused.
    refused(
      await apiA.rpc('waves_company_vendor_details_set', {
        p_group_id: groupA,
        p_vendor_id: vendorBInA,
        p_data: { ifsc: 'nope' },
      }),
    );

    // A second, unrelated vendor, to prove Bhavana never sees it.
    const rival = await apiA.rpc('waves_company_vendor_set', {
      p_group_id: groupA,
      p_vendor_id: randomUUID(),
      p_data: { name: VENDOR_RIVAL },
    });
    expect(rival.error).toBeNull();
  });

  test('before the invite, account B sees nothing of company A', async () => {
    for (const table of ['company_vendors', 'company_vendor_entries', 'company_vendor_orders']) {
      const res = await apiB.from(table).select('id').eq('group_id', groupA);
      expect(res.error).toBeNull();
      expect(res.data).toEqual([]);
    }
    const page = await ctxB.newPage();
    await page.goto(`/c/${groupA}/vendors`);
    await expect(page.getByText(VENDOR_B_IN_A)).toHaveCount(0);
    await page.close();
  });

  test('A invites B: a single-use link turns account B into that vendor in A', async () => {
    // An employee cannot mint vendor invites.
    refused(await apiE.rpc('waves_company_vendor_invite', { p_vendor_id: vendorBInA }));
    const minted = await apiA.rpc('waves_company_vendor_invite', { p_vendor_id: vendorBInA });
    expect(minted.error).toBeNull();
    const token = minted.data as string;

    const joined = await apiB.functions.invoke('invite-accept', { body: { token, mode: 'join' } });
    expect(joined.error).toBeNull();
    const member = await memberOf(groupA, bhavana.id);
    expect(member!.role).toBe('vendor');
    expect((await vendorRow(groupA, VENDOR_B_IN_A))!.member_id).toBe(member!.id);

    // Single use: a second account cannot reuse the link.
    const second = await apiC.functions.invoke('invite-accept', { body: { token, mode: 'join' } });
    expect(second.error).not.toBeNull();
    expect(await memberOf(groupA, chandra.id)).toBeUndefined();

    // A linked vendor needs no second invite.
    refused(await apiA.rpc('waves_company_vendor_invite', { p_vendor_id: vendorBInA }));
  });

  test('same person, two roles: B is a vendor in A and the owner of company B', async () => {
    expect((await memberOf(groupA, bhavana.id))!.role).toBe('vendor');
    expect((await memberOf(groupB, bhavana.id))!.role).toBe('admin');

    const asVendor = await ctxB.newPage();
    await asVendor.goto(`/c/${groupA}/vendors`);
    await expect(asVendor.getByRole('heading', { name: VENDOR_B_IN_A })).toBeVisible();
    await expect(asVendor.getByRole('link', { name: '+ Add vendor' })).toHaveCount(0);
    await expect(asVendor.getByText(VENDOR_RIVAL)).toHaveCount(0);
    await asVendor.close();

    const asOwner = await ctxB.newPage();
    await asOwner.goto(`/c/${groupB}/vendors`);
    await expect(asOwner.getByRole('link', { name: '+ Add vendor' })).toBeVisible();
    await asOwner.close();
  });

  test('A sends B an order; B accepts and delivers it; the order never moves the balance', async () => {
    orderAB = await sendOrderViaForm(ctxA, groupA, vendorBInA, 'Cement bags', '10', '400');
    const order = await admin.from('company_vendor_orders').select('*').eq('id', orderAB).single();
    expect(order.data!.status).toBe('sent');
    expect(order.data!.vendor_id).toBe(vendorBInA);
    expect(order.data!.order_no).toBe(1);
    const items = await admin
      .from('company_vendor_order_items')
      .select('name, qty, unit, unit_price')
      .eq('order_id', orderAB);
    expect(items.data!.map((i) => [i.name, Number(i.qty), i.unit, Number(i.unit_price)])).toEqual([
      ['Cement bags', 10, 'pieces', 40000],
    ]);
    expect(await owed(vendorBInA)).toBe(0);

    // B, as a vendor, sees the order and accepts it in the browser.
    const page = await ctxB.newPage();
    await page.goto(`/c/${groupA}/vendors`);
    await expect(page.getByRole('link', { name: /#PO-1/ })).toContainText(inr(4000));
    await page.goto(`/c/${groupA}/vendors/${vendorBInA}/orders/${orderAB}`);
    await expect(page.getByText('Cement bags').first()).toBeVisible();
    // A vendor cannot cancel or edit the company's order.
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Edit order' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect.poll(() => orderStatus(orderAB)).toBe('accepted');
    await page.getByRole('button', { name: 'Mark delivered' }).click();
    await expect.poll(() => orderStatus(orderAB)).toBe('delivered');
    await page.close();

    // History is written by the server, one row per change.
    const events = await admin
      .from('company_vendor_order_events')
      .select('status')
      .eq('order_id', orderAB)
      .order('created_at');
    expect(events.data!.map((e) => e.status)).toEqual(['sent', 'accepted', 'delivered']);

    // Delivered is final for the company, and a vendor can neither reopen nor create orders.
    refused(
      await apiA.rpc('waves_company_vendor_order_status', {
        p_order_id: orderAB,
        p_to: 'cancelled',
      }),
    );
    refused(
      await apiB.rpc('waves_company_vendor_order_status', {
        p_order_id: orderAB,
        p_to: 'accepted',
      }),
    );
    refused(
      await apiB.rpc('waves_company_vendor_order_set', {
        p_group_id: groupA,
        p_order_id: randomUUID(),
        p_vendor_id: vendorBInA,
        p_data: { items: [{ name: 'Sneaky', qty: '1', unit: 'pieces', unitPrice: '100' }] },
      }),
    );
  });

  test('B bills 10,000 (pending); only A confirming it makes A owe B', async () => {
    await vendorBillViaForm(ctxB, groupA, '10000');
    await expect.poll(async () => (await lines(vendorBInA)).length).toBe(1);
    const [bill] = await lines(vendorBInA);
    expect([bill.kind, Number(bill.amount), bill.status]).toEqual(['bill', 1000000, 'pending']);
    expect(bill.created_by).toBe((await memberOf(groupA, bhavana.id))!.id);
    expect(await owed(vendorBInA)).toBe(0);

    // A vendor cannot confirm its own bill, nor record a payment for itself.
    refused(
      await apiB.rpc('waves_company_vendor_entry_review', {
        p_entry_id: bill.id,
        p_to: 'approved',
        p_note: null,
        p_version: bill.version,
      }),
    );
    refused(
      await apiB.rpc('waves_company_vendor_entry_create', {
        p_group_id: groupA,
        p_entry_id: randomUUID(),
        p_vendor_id: vendorBInA,
        p_kind: 'payment',
        p_data: { amount: '100', occurredOn: today() },
      }),
    );

    // A confirms it in the browser.
    const page = await ctxA.newPage();
    await page.goto(`/c/${groupA}/vendors/${vendorBInA}`);
    await expect(page.getByText('Bills awaiting confirmation')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect.poll(async () => (await lines(vendorBInA))[0].status).toBe('approved');
    await page.close();
    expect(await owed(vendorBInA)).toBe(1000000);
  });

  test('A pays 4,000 then 1,500: partial payments leave exactly 4,500 owed', async () => {
    await payViaForm(ctxA, groupA, vendorBInA, '4000');
    await expect.poll(() => owed(vendorBInA)).toBe(600000);
    await payViaForm(ctxA, groupA, vendorBInA, '1500');
    await expect.poll(() => owed(vendorBInA)).toBe(450000);

    const pays = (await lines(vendorBInA)).filter((l) => l.kind === 'payment');
    expect(pays.map((p) => [Number(p.amount), p.method, p.status, p.receipt_no])).toEqual([
      [400000, 'cash', 'approved', 1],
      [150000, 'cash', 'approved', 2],
    ]);

    // The owner's ledger shows the exact balance.
    const own = await ctxA.newPage();
    await own.goto(`/c/${groupA}/vendors/${vendorBInA}`);
    await expect(own.getByText(inr(4500)).first()).toBeVisible();
    await own.close();

    // B's own screen says the same, in B's words.
    const page = await ctxB.newPage();
    await page.goto(`/c/${groupA}/vendors`);
    await expect(page.getByText(/The company owes you/)).toContainText(inr(4500));
    // Marking a payment received changes nothing about the balance.
    await page.getByRole('button', { name: 'Mark received' }).first().click();
    await expect
      .poll(async () => (await lines(vendorBInA)).filter((l) => l.received_at).length)
      .toBe(1);
    await page.close();
    expect(await owed(vendorBInA)).toBe(450000);
    const amounts = (await lines(vendorBInA)).filter((l) => l.kind === 'payment');
    expect(amounts.map((p) => Number(p.amount))).toEqual([400000, 150000]);
  });

  test('a pending bill is not owed, and a vendor can withdraw only its own pending bill', async () => {
    const id = randomUUID();
    const made = await apiB.rpc('waves_company_vendor_entry_create', {
      p_group_id: groupA,
      p_entry_id: id,
      p_vendor_id: vendorBInA,
      p_kind: 'bill',
      p_data: { amount: '70000', occurredOn: today(), dueOn: today() },
    });
    expect(made.error).toBeNull();
    expect(await owed(vendorBInA)).toBe(450000); // the 700 is pending, so not owed yet

    const voided = await apiB.rpc('waves_company_vendor_entry_void', {
      p_entry_id: id,
      p_reason: 'mistake',
    });
    expect(voided.error).toBeNull();
    expect(await owed(vendorBInA)).toBe(450000);

    // A confirmed bill cannot be withdrawn by the vendor.
    const confirmed = (await lines(vendorBInA)).find((l) => l.kind === 'bill')!;
    refused(
      await apiB.rpc('waves_company_vendor_entry_void', {
        p_entry_id: confirmed.id,
        p_reason: 'x',
      }),
    );
  });

  test('B updates its own bank card and A sees it; B cannot edit or remove the vendor record', async () => {
    const card = await apiB.rpc('waves_company_vendor_details_set', {
      p_group_id: groupA,
      p_vendor_id: vendorBInA,
      p_data: { bankName: 'HDFC Bank', bankAccount: '998877665544', ifsc: 'HDFC0000123' },
    });
    expect(card.error).toBeNull();
    const seenByA = await apiA
      .from('company_vendor_details')
      .select('bank_name, bank_account, bank_changed_at')
      .eq('vendor_id', vendorBInA)
      .single();
    expect(seenByA.data!.bank_account).toBe('998877665544');
    expect(seenByA.data!.bank_changed_at).not.toBeNull(); // the owner is told the bank changed

    refused(
      await apiB.rpc('waves_company_vendor_set', {
        p_group_id: groupA,
        p_vendor_id: vendorBInA,
        p_data: { name: 'Renamed by vendor' },
      }),
    );
    refused(await apiB.rpc('waves_company_vendor_remove', { p_vendor_id: vendorBInA }));
    expect((await vendorRow(groupA, VENDOR_B_IN_A))!.name).toBe(VENDOR_B_IN_A);
  });

  test('chain: B, as owner of company B, adds C as its vendor, orders, is billed and pays', async () => {
    vendorCInB = await addVendorViaForm(ctxB, groupB, VENDOR_C_IN_B, '9123456780');
    const token = await apiB.rpc('waves_company_vendor_invite', { p_vendor_id: vendorCInB });
    expect(token.error).toBeNull();
    const joined = await apiC.functions.invoke('invite-accept', {
      body: { token: token.data, mode: 'join' },
    });
    expect(joined.error).toBeNull();
    expect((await memberOf(groupB, chandra.id))!.role).toBe('vendor');

    orderBC = await sendOrderViaForm(ctxB, groupB, vendorCInB, 'Steel rods', '5', '1000');
    // Order numbers are per company: B's first order is #PO-1 even though A already used #PO-1.
    const order = await admin
      .from('company_vendor_orders')
      .select('order_no, group_id, status')
      .eq('id', orderBC)
      .single();
    expect(order.data).toEqual({ order_no: 1, group_id: groupB, status: 'sent' });

    const c = await ctxC.newPage();
    await c.goto(`/c/${groupB}/vendors/${vendorCInB}/orders/${orderBC}`);
    await expect(c.getByText('Steel rods').first()).toBeVisible();
    await c.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect.poll(() => orderStatus(orderBC)).toBe('accepted');
    await c.close();

    await vendorBillViaForm(ctxC, groupB, '5000');
    await expect.poll(async () => (await lines(vendorCInB)).length).toBe(1);
    const bOwn = await ctxB.newPage();
    await bOwn.goto(`/c/${groupB}/vendors/${vendorCInB}`);
    await bOwn.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect.poll(async () => (await lines(vendorCInB))[0].status).toBe('approved');
    await bOwn.close();

    await payViaForm(ctxB, groupB, vendorCInB, '2000');
    await expect.poll(() => owed(vendorCInB)).toBe(300000);
    const [pay] = (await lines(vendorCInB)).filter((l) => l.kind === 'payment');
    expect(pay.receipt_no).toBe(1); // receipt numbers are per company too

    const view = await ctxC.newPage();
    await view.goto(`/c/${groupB}/vendors`);
    await expect(view.getByText(/The company owes you/)).toContainText(inr(3000));
    await view.close();
  });

  test('no leak across the chain: A and C never see each other, B sees both sides separately', async () => {
    // C (vendor in B only): its own vendor row, order and ledger, nothing from company A.
    expect((await visible(apiC, 'company_vendors')).map((r) => r.id)).toEqual([vendorCInB]);
    expect((await visible(apiC, 'company_vendor_orders')).map((r) => r.id)).toEqual([orderBC]);
    const cLines = await visible(apiC, 'company_vendor_entries');
    expect(cLines).toHaveLength(2); // C's bill + B's payment
    expect(cLines.every((r) => r.group_id === groupB)).toBe(true);
    expect(
      (await visible(apiC, 'company_vendor_details')).every((r) => r.group_id === groupB),
    ).toBe(true);
    refused(await apiC.rpc('waves_company_people', { p_group_id: groupA }));

    // A (owner of A only): its two vendors, never anything of company B.
    const aVendors = await visible(apiA, 'company_vendors');
    expect(aVendors).toHaveLength(2);
    expect(aVendors.every((r) => r.group_id === groupA)).toBe(true);
    expect((await visible(apiA, 'company_vendor_orders')).map((r) => r.id)).toEqual([orderAB]);
    expect(
      (await visible(apiA, 'company_vendor_entries')).every((r) => r.group_id === groupA),
    ).toBe(true);
    refused(await apiA.rpc('waves_company_people', { p_group_id: groupB }));
    // A cannot act on B's vendor, order or ledger by guessing ids.
    refused(
      await apiA.rpc('waves_company_vendor_order_status', {
        p_order_id: orderBC,
        p_to: 'cancelled',
      }),
    );
    refused(
      await apiA.rpc('waves_company_vendor_entry_create', {
        p_group_id: groupA,
        p_entry_id: randomUUID(),
        p_vendor_id: vendorCInB,
        p_kind: 'payment',
        p_data: { amount: '100', occurredOn: today() },
      }),
    );
    // C cannot act on A's vendor, order or ledger either.
    refused(
      await apiC.rpc('waves_company_vendor_order_status', {
        p_order_id: orderAB,
        p_to: 'accepted',
      }),
    );
    refused(
      await apiC.rpc('waves_company_vendor_entry_create', {
        p_group_id: groupA,
        p_entry_id: randomUUID(),
        p_vendor_id: vendorBInA,
        p_kind: 'bill',
        p_data: { amount: '100', occurredOn: today() },
      }),
    );

    // B (vendor in A AND owner of B): its own vendor row in A, plus everything in B, kept apart.
    const bVendors = await visible(apiB, 'company_vendors');
    expect(bVendors.filter((r) => r.group_id === groupA).map((r) => r.id)).toEqual([vendorBInA]);
    expect(bVendors.filter((r) => r.group_id === groupB).map((r) => r.id)).toEqual([vendorCInB]);
    const bOrders = await visible(apiB, 'company_vendor_orders');
    expect(bOrders.map((r) => r.id).sort()).toEqual([orderAB, orderBC].sort());
    // 3 lines in A (bill + 2 payments), 2 in B (bill + payment).
    const bLines = await visible(apiB, 'company_vendor_entries');
    expect(bLines.filter((r) => r.group_id === groupA)).toHaveLength(3);
    expect(bLines.filter((r) => r.group_id === groupB)).toHaveLength(2);

    // The browser agrees: C opening company A's vendor page finds nothing.
    const page = await ctxC.newPage();
    await page.goto(`/c/${groupA}/vendors/${vendorBInA}`);
    await expect(page.getByText(VENDOR_B_IN_A)).toHaveCount(0);
    await expect(page.getByText(inr(4500))).toHaveCount(0);
    await page.close();
  });

  test("a vendor sees nothing of the buyer's employees, tasks, attendance or money", async () => {
    // Give company A real employee data first: an advance for Esha, through the owner's form.
    const page = await ctxA.newPage();
    await page.goto(`/c/${groupA}/entry/new?member=${eshaMemberId}`);
    await saveEntry(page, '500');
    await page.close();
    const seeded = await admin.from('company_entries').select('id').eq('group_id', groupA);
    expect(seeded.data!.length).toBeGreaterThan(0);

    for (const [label, api] of [
      ['B', apiB],
      ['C', apiC],
    ] as const) {
      const res = await api.from('company_entries').select('id').eq('group_id', groupA);
      expect(res.error, label).toBeNull();
      expect(res.data, label).toEqual([]);
      // shortcut: these tables are not seeded here, so this is an emptiness check only; seed them when a helper exists.
      for (const table of [
        'company_attendance',
        'company_leave',
        'company_work_tasks',
        'company_documents',
        'company_clients',
      ]) {
        const other = await api.from(table).select('id').eq('group_id', groupA);
        expect(other.data ?? [], `${label} ${table}`).toEqual([]);
      }
    }

    // B may know who the owner is, but not Esha.
    const people = await apiB.rpc('waves_company_people', { p_group_id: groupA });
    expect(people.error).toBeNull();
    const rows = people.data as Array<{ role: string; member_id: string }>;
    expect(rows.map((p) => p.role).sort()).toEqual(['admin', 'vendor']);
    expect(rows.some((p) => p.member_id === eshaMemberId)).toBe(false);

    // And in the browser, a vendor's view of company A never shows Esha.
    const home = await ctxB.newPage();
    await home.goto(`/c/${groupA}`);
    await expect(home.getByText(esha.name)).toHaveCount(0);
    await home.goto(`/c/${groupA}/vendors`);
    await expect(home.getByText(esha.name)).toHaveCount(0);
    await home.close();
  });

  test('control: an employee of A sees and can do nothing with vendors', async () => {
    for (const table of [
      'company_vendors',
      'company_vendor_entries',
      'company_vendor_orders',
      'company_vendor_order_items',
      'company_vendor_order_events',
      'company_vendor_details',
    ]) {
      const res = await apiE.from(table).select('*').eq('group_id', groupA);
      expect(res.error, table).toBeNull();
      expect(res.data, table).toEqual([]);
    }
    refused(
      await apiE.rpc('waves_company_vendor_set', {
        p_group_id: groupA,
        p_vendor_id: randomUUID(),
        p_data: { name: 'Employee vendor' },
      }),
    );
    refused(
      await apiE.rpc('waves_company_vendor_entry_create', {
        p_group_id: groupA,
        p_entry_id: randomUUID(),
        p_vendor_id: vendorBInA,
        p_kind: 'bill',
        p_data: { amount: '100', occurredOn: today() },
      }),
    );
    refused(
      await apiE.rpc('waves_company_vendor_order_status', {
        p_order_id: orderAB,
        p_to: 'cancelled',
      }),
    );
    refused(
      await apiE.rpc('waves_company_vendor_details_set', {
        p_group_id: groupA,
        p_vendor_id: vendorBInA,
        p_data: { bankName: 'Evil Bank' },
      }),
    );

    const page = await ctxE.newPage();
    await page.goto(`/c/${groupA}/vendors`);
    await expect(page.getByText(VENDOR_B_IN_A)).toHaveCount(0);
    await expect(page.getByRole('link', { name: '+ Add vendor' })).toHaveCount(0);
    await page.close();
  });

  test('B removes C: C loses the ledger at once, and A and B are untouched', async () => {
    const removed = await apiB.rpc('waves_company_vendor_remove', { p_vendor_id: vendorCInB });
    expect(removed.error).toBeNull();
    const row = await admin
      .from('company_vendors')
      .select('deleted_at, member_id')
      .eq('id', vendorCInB)
      .single();
    expect(row.data!.deleted_at).not.toBeNull();
    expect(row.data!.member_id).toBeNull();
    expect((await memberOf(groupB, chandra.id))!.left_at).not.toBeNull();

    for (const table of ['company_vendors', 'company_vendor_entries', 'company_vendor_orders']) {
      const res = await apiC.from(table).select('id');
      expect(res.error, table).toBeNull();
      expect(res.data, table).toEqual([]);
    }
    refused(
      await apiC.rpc('waves_company_vendor_entry_create', {
        p_group_id: groupB,
        p_entry_id: randomUUID(),
        p_vendor_id: vendorCInB,
        p_kind: 'bill',
        p_data: { amount: '100', occurredOn: today() },
      }),
    );
    const page = await ctxC.newPage();
    await page.goto(`/c/${groupB}/vendors`);
    await expect(page.getByText(inr(3000))).toHaveCount(0);
    await page.close();

    // Company A's relationship with B is unaffected, to the rupee.
    expect(await owed(vendorBInA)).toBe(450000);
    const stillSees = await apiB.from('company_vendors').select('id').eq('id', vendorBInA);
    expect(stillSees.data).toHaveLength(1);
  });

  test('A removes B as a vendor; B keeps owning company B', async () => {
    const removed = await apiA.rpc('waves_company_vendor_remove', { p_vendor_id: vendorBInA });
    expect(removed.error).toBeNull();
    expect((await memberOf(groupA, bhavana.id))!.left_at).not.toBeNull();
    for (const table of ['company_vendors', 'company_vendor_entries', 'company_vendor_orders']) {
      const res = await apiB.from(table).select('id').eq('group_id', groupA);
      expect(res.data, table).toEqual([]);
    }
    // B's own company is intact: it can still add vendors there.
    const again = await apiB.rpc('waves_company_vendor_set', {
      p_group_id: groupB,
      p_vendor_id: randomUUID(),
      p_data: { name: `Second supplier ${stamp}` },
    });
    expect(again.error).toBeNull();
    expect((await memberOf(groupB, bhavana.id))!.role).toBe('admin');
  });

  test.fixme('block a single vendor (keep the record, stop the login)', async () => {
    // There is no per-vendor block: the only ways to cut a vendor off are waves_company_vendor_remove
    // (covered above) and a whole-company suspension by the Waves admin console (not reachable here).
  });

  test.fixme("company B sees A as a customer, or A's order as a sale in B", async () => {
    // Companies are not linked: a vendor login only sees its own ledger inside the buyer's company,
    // and a purchase in A creates nothing in company B's books.
  });
});
