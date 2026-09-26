/**
 * Friends and categories — the two cross-group lists.
 *
 * "Friends" in Waves is not a friend list. There is no such table and nothing to
 * add somebody to: it is the derived answer to "who am I not square with",
 * netted across every group you share with them, per currency. That is why there
 * is no `POST /v1/friends` — adding a person is making a group with them in it.
 *
 * What there is, is `POST /v1/friends/expenses`: an individual expense, the one
 * thing people most often want to record with a single person. It goes in the
 * caller's one-to-one group with them — the two-member group the app shows as
 * that person — found by name, or made the way the app makes one when there is
 * none (see `server/pair.ts`). The ledger gains no new concept: it is still an
 * ordinary expense in an ordinary group.
 *
 * Categories are the other half: a person's own tag catalogue, which overrides
 * or extends the built-in set. Owned by one account, never shared, so the whole
 * surface is scoped by the `category_tags` owner policy rather than by anything
 * written here.
 */

import { Hono } from 'hono';
import type { Expense, PersonBalanceRow } from '@waves/api-client';
import { CATEGORIES } from '@waves/core';

import { caller, requireScope, type ApiEnv } from '../../server/authorize';
import { ApiError } from '../../server/errors';
import { boolOrThrow, currencyOrThrow, dateOrThrow, textOrThrow } from '../../server/fields';
import { findPair, foldName, loadPairGroups, SELF } from '../../server/pair';
import { derivedId, jsonBody, mutationIdFor } from '../../server/request';
import { toCategory, toExpense, toFriend, type CategoryTagRow } from '../../server/resources';
import { EXPENSE_COLUMNS, minor } from './expenses';

const CATEGORY_COLUMNS = 'id, builtin_id, label, icon, tint, axis, sort_order, hidden';

/** The six design-system tints a custom tag may wear. */
const TINTS = ['lilac', 'pink', 'mint', 'peach', 'sky', 'coral'];

/**
 * The built-in categories a row may override, taken from the catalogue every
 * client resolves against rather than accepted as any string. A row overriding
 * a built-in that does not exist is invisible: it resolves to nothing, in every
 * app, forever, and nobody is told why their colour did not take.
 */
const BUILTIN_IDS = CATEGORIES.map((category) => String(category.id));

/** Null or an empty string clears the field; anything else has to be text. */
function clearOrText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === '') return null;
  return textOrThrow(value, field, max);
}

function tintOrThrow(value: unknown): string {
  if (typeof value !== 'string' || !TINTS.includes(value)) {
    throw new ApiError(
      'invalid_request',
      `tint is one of: ${TINTS.join(', ')}.`,
      {},
      {
        field: 'tint',
      },
    );
  }
  return value;
}

function axisOrThrow(value: unknown): string {
  if (value !== 'expense' && value !== 'income') {
    throw new ApiError('invalid_request', 'axis is "expense" or "income".', {}, { field: 'axis' });
  }
  return value;
}

export const people = new Hono<ApiEnv>();

people.get('/friends', requireScope('friends.read'), async (c) => {
  const me = caller(c);
  const { data, error } = await me.supabase.rpc('waves_people_i_owe');
  if (error) throw error;
  const rows = (data ?? []) as unknown as PersonBalanceRow[];
  return c.json({ data: rows.map(toFriend) });
});

people.post('/friends/expenses', requireScope('expenses.write'), async (c) => {
  const me = caller(c);
  const body = await jsonBody(c.req.raw);

  const name = textOrThrow(body.name, 'name', 80);
  if (SELF.has(foldName(name))) {
    throw new ApiError(
      'invalid_request',
      'name is who the expense is with — somebody other than you.',
      {},
      { field: 'name' },
    );
  }
  const description = textOrThrow(body.description, 'description', 200);
  const amount = minor(body.amount, 'amount');
  const expenseDate = dateOrThrow(body.expense_date, 'expense_date');
  if (!expenseDate) throw new ApiError('invalid_request', 'expense_date is required.');
  const asked = 'currency' in body ? currencyOrThrow(body.currency, 'currency') : null;

  const paidBy = body.paid_by ?? 'me';
  if (paidBy !== 'me' && paidBy !== 'them') {
    throw new ApiError('invalid_request', 'paid_by is "me" or "them".', {}, { field: 'paid_by' });
  }

  // The split names people as "mine" and "theirs" rather than by member id: a
  // caller starting a one-to-one cannot know the ids of a group that does not
  // exist yet. Translated to member ids below, then checked by the edge
  // function like every other split.
  const split = body.split ?? { kind: 'equal' };
  let shares: { mine: bigint; theirs: bigint } | null = null;
  if (typeof split !== 'object' || split === null || Array.isArray(split)) {
    throw new ApiError('invalid_request', 'split is an object; omit it for half each.');
  }
  const kind = (split as { kind?: unknown }).kind;
  if (kind === 'exact') {
    const { mine, theirs } = split as { mine?: unknown; theirs?: unknown };
    shares = { mine: minor(mine, 'split.mine'), theirs: minor(theirs, 'split.theirs') };
  } else if (kind !== 'equal') {
    throw new ApiError(
      'invalid_request',
      'split is {"kind":"equal"} or {"kind":"exact","mine":"…","theirs":"…"}.',
      {},
      { field: 'split' },
    );
  }

  const mutationId = mutationIdFor(
    me.tokenId,
    'POST /v1/friends/expenses',
    c.req.header('Idempotency-Key'),
  );

  const found = findPair(await loadPairGroups(me.supabase), me.profileId, name);
  if (found.kind === 'ambiguous') {
    throw new ApiError(
      'conflict',
      `You have ${found.candidates.length} one-to-one groups with "${name}". Add the expense to one of them with POST /v1/expenses.`,
      {},
      {
        candidates: found.candidates.map((candidate) => ({
          group_id: candidate.groupId,
          name: candidate.name,
        })),
      },
    );
  }

  let groupId: string;
  let mine: string;
  let theirs: string;
  let theirName: string;
  let currency: string;
  if (found.kind === 'found') {
    groupId = found.group.groupId;
    mine = found.me.memberId;
    theirs = found.them.memberId;
    theirName = found.them.name;
    currency = asked ?? found.group.currency;
  } else {
    // Starting a one-to-one makes a group, so it takes the scope that making a
    // group takes. An expense in an existing one does not.
    if (!me.scopes.includes('groups.write')) {
      throw new ApiError(
        'insufficient_scope',
        `You have no one-to-one group with "${name}" yet, and starting one needs the groups.write scope.`,
      );
    }
    if (asked) {
      currency = asked;
    } else {
      const { data } = await me.supabase
        .from('profiles')
        .select('default_currency')
        .eq('id', me.profileId)
        .maybeSingle();
      currency = String((data as { default_currency?: string } | null)?.default_currency ?? 'INR');
    }

    // Every id derives from the idempotency key, so a retry after a failure
    // halfway finds the pair it already made rather than starting a second.
    groupId = derivedId(mutationId, 'group');
    mine = derivedId(mutationId, 'creator-member');
    theirs = derivedId(mutationId, 'member');
    theirName = name;
    const { error: groupError } = await me.supabase.rpc('waves_create_group', {
      p_name: name,
      p_type: 'other',
      p_currency: currency,
      p_emoji: null,
      p_simplify: true,
      p_group_id: groupId,
      p_photo_path: null,
      p_country: null,
      p_creator_member_id: mine,
    });
    if (groupError) throw groupError;
    const { error: ghostError } = await me.supabase.rpc('waves_add_ghost_member', {
      p_group_id: groupId,
      p_name: name,
      p_member_id: theirs,
      p_email: null,
      p_phone: null,
    });
    if (ghostError) throw ghostError;
  }

  const result = await me.waves.writeExpense({
    groupId,
    description,
    category: typeof body.category === 'string' ? body.category : null,
    expenseDate,
    currency,
    amount,
    splitParams: shares
      ? {
          kind: 'exact',
          amounts: { [mine]: String(shares.mine), [theirs]: String(shares.theirs) },
        }
      : { kind: 'equal' },
    participants: [mine, theirs],
    payers: { [paidBy === 'them' ? theirs : mine]: amount },
    notes: typeof body.notes === 'string' ? body.notes : null,
    clientMutationId: mutationId,
  });

  const { data } = await me.supabase
    .from('expenses')
    .select(EXPENSE_COLUMNS)
    .eq('id', result.expenseId)
    .limit(1);
  const expense = toExpense((data ?? [])[0] as unknown as Expense);
  if (!expense) {
    throw new ApiError('internal', 'The expense was written but could not be read back.');
  }
  c.status(201);
  return c.json({
    group_id: groupId,
    created_group: found.kind === 'none',
    person: { member_id: theirs, name: theirName },
    expense,
  });
});

people.get('/categories', requireScope('categories.read'), async (c) => {
  const me = caller(c);
  const { data, error } = await me.supabase
    .from('category_tags')
    .select(CATEGORY_COLUMNS)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return c.json({ data: (data ?? []).map((row) => toCategory(row as unknown as CategoryTagRow)) });
});

people.post('/categories', requireScope('categories.write'), async (c) => {
  const me = caller(c);
  const body = await jsonBody(c.req.raw);

  const builtinId = typeof body.builtin_id === 'string' ? body.builtin_id.trim() : null;
  const label = 'label' in body ? (clearOrText(body.label, 'label', 40) ?? '') : '';
  // Two shapes: overriding a built-in (which carries only presentation) and
  // minting a custom tag (which needs a name and a glyph). Asking for both at
  // once means the caller has not decided which they meant.
  if (builtinId && label) {
    throw new ApiError(
      'invalid_request',
      'A row either overrides a built-in or is a tag of its own.',
    );
  }
  if (!builtinId && !label) {
    throw new ApiError(
      'invalid_request',
      'Send a label for a new tag, or a builtin_id to override one.',
    );
  }
  if (builtinId && !BUILTIN_IDS.includes(builtinId)) {
    throw new ApiError(
      'invalid_request',
      `builtin_id is one of the built-in categories: ${BUILTIN_IDS.join(', ')}.`,
      {},
      { field: 'builtin_id' },
    );
  }
  // Read by presence and refused on the wrong type, exactly as the PATCH beside
  // this does. Creating with a rule the edit does not share is the trap that
  // produces a 60-character label you cannot then edit back to itself.
  const tint = 'tint' in body && body.tint !== null ? tintOrThrow(body.tint) : null;
  const axis = 'axis' in body ? axisOrThrow(body.axis) : 'expense';
  const icon = 'icon' in body ? clearOrText(body.icon, 'icon', 64) : null;
  const hidden = 'hidden' in body ? boolOrThrow(body.hidden, 'hidden') : false;
  let sortOrder = 0;
  if ('sort_order' in body) {
    if (!Number.isInteger(body.sort_order)) {
      throw new ApiError(
        'invalid_request',
        'sort_order is a whole number.',
        {},
        { field: 'sort_order' },
      );
    }
    sortOrder = body.sort_order as number;
  }

  // The id is derived from the idempotency key like every other create in this
  // API, so a retry collides with the row it already wrote instead of adding a
  // second tag to somebody's picker. With no key it is a fresh random id, which
  // is what sending no key means.
  const mutationId = mutationIdFor(
    me.tokenId,
    'POST /v1/categories',
    c.req.header('Idempotency-Key'),
  );
  const row = {
    id: derivedId(mutationId, 'category'),
    owner_user_id: me.profileId,
    builtin_id: builtinId,
    label: label || null,
    icon,
    tint,
    axis,
    sort_order: sortOrder,
    hidden,
  };

  const { data, error } = await me.supabase
    .from('category_tags')
    .insert(row)
    .select(CATEGORY_COLUMNS);
  if (error) throw error;
  const created = (data ?? [])[0];
  if (!created)
    throw new ApiError('internal', 'The category was written but could not be read back.');
  c.status(201);
  return c.json(toCategory(created as unknown as CategoryTagRow));
});

people.patch('/categories/:categoryId', requireScope('categories.write'), async (c) => {
  const me = caller(c);
  const body = await jsonBody(c.req.raw);

  // Presence, not type. `"label": null` and `"label": ""` are both a caller
  // saying "clear this", and reading only the string form would silently ignore
  // one of them — a write that reports success and changes nothing.
  const patch: Record<string, unknown> = {};
  if ('label' in body) patch.label = clearOrText(body.label, 'label', 40);
  if ('icon' in body) patch.icon = clearOrText(body.icon, 'icon', 64);
  // Null clears it, the same way it clears a label. A colour you could set at
  // creation and never take off again would be the one field on this row that
  // is permanent, for no reason anybody could give.
  if ('tint' in body) patch.tint = body.tint === null ? null : tintOrThrow(body.tint);
  if ('hidden' in body) patch.hidden = boolOrThrow(body.hidden, 'hidden');
  if ('sort_order' in body) {
    if (!Number.isInteger(body.sort_order)) {
      throw new ApiError(
        'invalid_request',
        'sort_order is a whole number.',
        {},
        {
          field: 'sort_order',
        },
      );
    }
    patch.sort_order = body.sort_order;
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiError(
      'invalid_request',
      'Send at least one of: label, icon, tint, hidden, sort_order.',
    );
  }

  const { data, error } = await me.supabase
    .from('category_tags')
    .update(patch)
    .eq('id', c.req.param('categoryId'))
    .select(CATEGORY_COLUMNS);
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) throw new ApiError('not_found', 'No category of yours has that id.');
  return c.json(toCategory(row as unknown as CategoryTagRow));
});

people.delete('/categories/:categoryId', requireScope('categories.write'), async (c) => {
  const me = caller(c);
  // A tombstone, because the catalogue syncs to the phone and a row that simply
  // vanished would come back on the next pull (TDR A34 soft-delete).
  const { data, error } = await me.supabase
    .from('category_tags')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', c.req.param('categoryId'))
    .is('deleted_at', null)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new ApiError('not_found', 'No category of yours has that id.');
  }
  c.status(204);
  return c.body(null);
});
