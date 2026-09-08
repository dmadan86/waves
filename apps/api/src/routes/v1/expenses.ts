/**
 * The ledger itself.
 *
 * Not one line of split arithmetic happens in this file, and that is the single
 * most important thing about it. A write is assembled and handed to the
 * `expense-write` edge function, which recomputes every share from the split
 * parameters with `@waves/core` — the same code the phone runs — and refuses
 * the write with `SHARE_MISMATCH` if the caller's numbers disagree (TDR §4).
 * The client's arithmetic is a claim to be checked, never an instruction, and
 * that does not relax because the client is somebody else's program.
 *
 * The other consequence is that this API cannot drift from the app. If the
 * remainder rotation changes, or a new split kind appears, an integration gets
 * it for free, because both went through the same door.
 */

import { Hono } from 'hono';
import type { Expense } from '@waves/api-client';

import { caller, requireScope, type ApiEnv } from '../../server/authorize';
import { ApiError } from '../../server/errors';
import { currencyOrThrow, dateOrThrow, textOrThrow } from '../../server/fields';
import {
  decodeCursor,
  encodeCursor,
  jsonBody,
  keysetFilter,
  mutationIdFor,
  pageSize,
  queryFlag,
} from '../../server/request';
import { toExpense, type ExpenseResource } from '../../server/resources';

const EXPENSE_COLUMNS = `
  id, group_id, deleted_at, created_at,
  currentVersion:expense_versions!expenses_current_version_id_fkey (
    id, version_no, description, category, expense_date, currency, amount,
    split_type, split_params, location,
    payers:expense_payers ( member_id, amount ),
    shares:expense_shares ( member_id, amount )
  )
`;

export const expenses = new Hono<ApiEnv>();

/** Minor units arrive as decimal strings. A JSON number here is a rounding bug. */
function minor(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value)) {
    throw new ApiError(
      'invalid_request',
      `${field} is a whole number of minor units, as a string — "1250" is ₹12.50.`,
    );
  }
  return BigInt(value);
}

function payerMap(value: unknown): Record<string, bigint> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError('invalid_request', 'payers maps a member id to what they put in.');
  }
  const out: Record<string, bigint> = {};
  for (const [memberId, amount] of Object.entries(value as Record<string, unknown>)) {
    out[memberId] = minor(amount, `payers.${memberId}`);
  }
  if (Object.keys(out).length === 0) {
    throw new ApiError('invalid_request', 'payers needs at least one member.');
  }
  return out;
}

function participantList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError('invalid_request', 'participants is a non-empty list of member ids.');
  }
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new ApiError('invalid_request', 'participants holds member ids.');
    }
  }
  return value as string[];
}

/** Everything both a create and an update need, read out of the body once. */
function writeInput(body: Record<string, unknown>, route: string) {
  // The shared checkers rather than a second copy of the same two regexes: a
  // currency is `character(3)` and a date is `date` here exactly as they are on
  // a group, and two spellings of the same rule is how they come to disagree.
  const description = textOrThrow(body.description, 'description', 200);
  const currency = currencyOrThrow(body.currency, 'currency');
  const expenseDate = dateOrThrow(body.expense_date, 'expense_date');
  if (!expenseDate) throw new ApiError('invalid_request', 'expense_date is required.');

  // Passed through untouched. The edge function parses it with the shared
  // `parseSplitParams`, so the accepted grammar is whatever the app accepts —
  // this file has no opinion and cannot fall behind.
  const splitParams = body.split ?? { kind: 'equal' };
  if (typeof splitParams !== 'object' || splitParams === null || Array.isArray(splitParams)) {
    throw new ApiError('invalid_request', 'split is an object; omit it for an equal split.');
  }

  return {
    route,
    description,
    currency,
    expenseDate,
    amount: minor(body.amount, 'amount'),
    payers: payerMap(body.payers),
    participants: participantList(body.participants),
    splitParams,
    category: typeof body.category === 'string' ? body.category : null,
    notes: typeof body.notes === 'string' ? body.notes : null,
  };
}

expenses.get('/expenses', requireScope('expenses.read'), async (c) => {
  const me = caller(c);
  const limit = pageSize(c.req.query('limit'));
  const cursor = decodeCursor(c.req.query('cursor'));
  const groupId = c.req.query('group_id');
  const includeDeleted = queryFlag(c.req.query('include_deleted'), 'include_deleted');

  let query = me.supabase
    .from('expenses')
    .select(EXPENSE_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (groupId) query = query.eq('group_id', groupId);
  if (!includeDeleted) query = query.is('deleted_at', null);
  if (cursor) query = query.or(keysetFilter(cursor, 'created_at'));

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as Expense[];

  // The page boundary is decided on the rows the database returned, before any
  // are dropped. A row whose current version is not readable is not a resource —
  // half an expense is worse than none — but shaping first and paging after
  // would let one such row make a full page look like a short one, and the
  // client would stop with a `next_cursor` of null and expenses still unread.
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const shaped = page
    .map(toExpense)
    .filter((resource): resource is ExpenseResource => resource !== null);

  return c.json({
    data: shaped,
    next_cursor:
      rows.length > limit && last ? encodeCursor({ key: last.created_at, id: last.id }) : null,
  });
});

expenses.get('/expenses/:expenseId', requireScope('expenses.read'), async (c) => {
  const me = caller(c);
  const { data, error } = await me.supabase
    .from('expenses')
    .select(EXPENSE_COLUMNS)
    .eq('id', c.req.param('expenseId'))
    .limit(1);
  if (error) throw error;
  const resource = toExpense((data ?? [])[0] as unknown as Expense);
  if (!resource) throw new ApiError('not_found', 'No expense you can see has that id.');
  return c.json(resource);
});

expenses.post('/expenses', requireScope('expenses.write'), async (c) => {
  const me = caller(c);
  const body = await jsonBody(c.req.raw);
  const groupId = typeof body.group_id === 'string' ? body.group_id : '';
  if (!groupId) throw new ApiError('invalid_request', 'group_id says where the expense goes.');

  const input = writeInput(body, 'POST /v1/expenses');
  const clientMutationId = mutationIdFor(me.tokenId, input.route, c.req.header('Idempotency-Key'));

  const result = await me.waves.writeExpense({
    groupId,
    description: input.description,
    category: input.category,
    expenseDate: input.expenseDate,
    currency: input.currency,
    amount: input.amount,
    splitParams: input.splitParams,
    participants: input.participants,
    payers: input.payers,
    notes: input.notes,
    clientMutationId,
  });

  const { data } = await me.supabase
    .from('expenses')
    .select(EXPENSE_COLUMNS)
    .eq('id', result.expenseId)
    .limit(1);
  const resource = toExpense((data ?? [])[0] as unknown as Expense);
  if (!resource)
    throw new ApiError('internal', 'The expense was written but could not be read back.');
  c.status(201);
  return c.json(resource);
});

expenses.patch('/expenses/:expenseId', requireScope('expenses.write'), async (c) => {
  const me = caller(c);
  const expenseId = c.req.param('expenseId');
  const body = await jsonBody(c.req.raw);

  // The group comes from the expense, never from the body. A caller who named a
  // different group they happen to be a member of would pass the edge function's
  // membership check and only then be refused deeper in, on a rule that exists
  // for a different reason; reading it here means there is no group id in this
  // request that anybody chose. An expense the caller cannot see is not found,
  // which is also the right answer for one that does not exist.
  const existing = await me.supabase
    .from('expenses')
    .select('id, group_id')
    .eq('id', expenseId)
    .is('deleted_at', null)
    .limit(1);
  if (existing.error) throw existing.error;
  const groupId = (existing.data ?? [])[0]?.group_id as string | undefined;
  if (!groupId) throw new ApiError('not_found', 'No expense you can edit has that id.');

  // An edit is a new version, not a mutation of the old one (ADR-004), so it
  // carries the whole expense rather than a patch — there is no "change only
  // the amount" because a version is a complete snapshot.
  const input = writeInput(body, `PATCH /v1/expenses/${expenseId}`);

  // `base_version_no` is what turns a concurrent edit into a refusal instead of
  // a silent overwrite. It is optional because a caller that has genuinely just
  // read the expense can pass it and a fire-and-forget script cannot, but it is
  // documented as the thing to send.
  let baseVersionNo: number | null = null;
  if (body.base_version_no !== undefined) {
    if (!Number.isInteger(body.base_version_no)) {
      throw new ApiError('invalid_request', 'base_version_no is the version_no you edited.');
    }
    baseVersionNo = body.base_version_no as number;
  }

  await me.waves.writeExpense({
    groupId,
    expenseId,
    description: input.description,
    category: input.category,
    expenseDate: input.expenseDate,
    currency: input.currency,
    amount: input.amount,
    splitParams: input.splitParams,
    participants: input.participants,
    payers: input.payers,
    notes: input.notes,
    baseVersionNo,
    clientMutationId: mutationIdFor(me.tokenId, input.route, c.req.header('Idempotency-Key')),
  });

  const { data } = await me.supabase
    .from('expenses')
    .select(EXPENSE_COLUMNS)
    .eq('id', expenseId)
    .limit(1);
  const resource = toExpense((data ?? [])[0] as unknown as Expense);
  if (!resource) throw new ApiError('not_found', 'No expense you can see has that id.');
  return c.json(resource);
});

expenses.delete('/expenses/:expenseId', requireScope('expenses.write'), async (c) => {
  const me = caller(c);
  // Soft, and restorable. A share somebody could remove for good would be a debt
  // they could delete.
  const { error } = await me.supabase.rpc('waves_delete_expense', {
    p_expense_id: c.req.param('expenseId'),
  });
  if (error) throw error;
  c.status(204);
  return c.body(null);
});

expenses.post('/expenses/:expenseId/restore', requireScope('expenses.write'), async (c) => {
  const me = caller(c);
  const expenseId = c.req.param('expenseId');
  const { error } = await me.supabase.rpc('waves_restore_expense', { p_expense_id: expenseId });
  if (error) throw error;

  const { data } = await me.supabase
    .from('expenses')
    .select(EXPENSE_COLUMNS)
    .eq('id', expenseId)
    .limit(1);
  const resource = toExpense((data ?? [])[0] as unknown as Expense);
  if (!resource) throw new ApiError('not_found', 'No expense you can see has that id.');
  return c.json(resource);
});
