/**
 * Groups, the people in them, and what each of those people is owed.
 *
 * Every `:groupId` in this file is unvalidated on purpose. There is no
 * "does this token own that group" check anywhere below, because there is
 * nothing this file could add: the read runs under the caller's own session and
 * `groups_select` is `USING (is_group_member(id))`, so a group they are not in
 * is not a forbidden row — it is no row, and the handler turns that into a 404.
 * A second membership check here would be a copy of the policy that could
 * disagree with it, and the copy is always the one that is wrong.
 *
 * Writes go the same way. Creating a group, adding a ghost and changing a role
 * are `SECURITY DEFINER` RPCs that decide authority themselves (ADR-013); this
 * file supplies arguments and translates refusals.
 */

import { Hono } from 'hono';
import { GroupType, type GroupRow, type MemberRow } from '@waves/api-client';

import { caller, requireScope, type ApiEnv } from '../../server/authorize';
import { ApiError } from '../../server/errors';
import {
  boolOrThrow,
  countryOrThrow,
  currencyOrThrow,
  dateOrThrow,
  textOrThrow,
} from '../../server/fields';
import {
  decodeCursor,
  derivedId,
  jsonBody,
  keysetFilter,
  mutationIdFor,
  pageSize,
  queryFlag,
  toPage,
} from '../../server/request';
import { toBalance, toGroup, toMember } from '../../server/resources';

const GROUP_COLUMNS = `
  id, name, type, country_code, default_currency, simplify_debts, cover_emoji, photo_path,
  start_date, end_date, archived_at, created_at, updated_seq
`;

const MEMBER_COLUMNS = `
  id, group_id, profile_id, ghost_name, role, vpa, left_at,
  profile:profiles!profile_id ( id, display_name, avatar_url, default_vpa )
`;

const GROUP_TYPES = Object.values(GroupType) as string[];

/** Columns a token may set on a group. `archived_at` is here; `join_token` never is. */
const EDITABLE = [
  'name',
  'type',
  'cover_emoji',
  'simplify_debts',
  'default_currency',
  'country_code',
  'start_date',
  'end_date',
] as const;

export const groups = new Hono<ApiEnv>();

groups.get('/groups', requireScope('groups.read'), async (c) => {
  const me = caller(c);
  const limit = pageSize(c.req.query('limit'));
  const cursor = decodeCursor(c.req.query('cursor'));
  const includeArchived = queryFlag(c.req.query('include_archived'), 'include_archived');

  let query = me.supabase
    .from('groups')
    .select(GROUP_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (!includeArchived) query = query.is('archived_at', null);
  if (cursor) query = query.or(keysetFilter(cursor, 'created_at'));

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as GroupRow[];
  return c.json(
    toPage(rows.map(toGroup), limit, (group) => ({ key: group.created_at, id: group.id })),
  );
});

groups.post('/groups', requireScope('groups.write'), async (c) => {
  const me = caller(c);
  const body = await jsonBody(c.req.raw);
  const mutationId = mutationIdFor(me.tokenId, 'POST /v1/groups', c.req.header('Idempotency-Key'));

  const type = typeof body.type === 'string' ? body.type : GroupType.Other;
  if (!GROUP_TYPES.includes(type)) {
    throw new ApiError('invalid_request', `type is one of: ${GROUP_TYPES.join(', ')}.`);
  }
  const currency = currencyOrThrow(body.default_currency, 'default_currency');

  // A name is optional throughout Waves — a group with none is labelled by who
  // is in it — so an empty one is a choice, not a validation failure. The length
  // cap is the same one PATCH applies, because a name you can create and cannot
  // then edit back to itself is a trap.
  const name =
    typeof body.name === 'string' && body.name.trim() ? textOrThrow(body.name, 'name', 80) : null;
  const coverEmoji =
    typeof body.cover_emoji === 'string' && body.cover_emoji.trim()
      ? textOrThrow(body.cover_emoji, 'cover_emoji', 16)
      : null;

  // The group id is derived from the idempotency key rather than minted by the
  // database, which is what makes a retried create return the same group
  // instead of a second one. `waves_create_group` takes the id for exactly this.
  const groupId = derivedId(mutationId, 'group');
  const { error } = await me.supabase.rpc('waves_create_group', {
    p_name: name,
    p_type: type,
    p_currency: currency,
    p_emoji: coverEmoji,
    p_simplify: typeof body.simplify_debts === 'boolean' ? body.simplify_debts : true,
    p_group_id: groupId,
    p_photo_path: null,
    p_country: 'country_code' in body ? countryOrThrow(body.country_code, 'country_code') : null,
    p_creator_member_id: derivedId(mutationId, 'creator-member'),
  });
  if (error) throw error;

  const { data } = await me.supabase
    .from('groups')
    .select(GROUP_COLUMNS)
    .eq('id', groupId)
    .limit(1);
  const row = (data ?? [])[0] as unknown as GroupRow | undefined;
  if (!row) throw new ApiError('internal', 'The group was created but could not be read back.');
  c.status(201);
  return c.json(toGroup(row));
});

groups.get('/groups/:groupId', requireScope('groups.read'), async (c) => {
  const me = caller(c);
  const { data, error } = await me.supabase
    .from('groups')
    .select(GROUP_COLUMNS)
    .eq('id', c.req.param('groupId'))
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as unknown as GroupRow | undefined;
  if (!row) throw new ApiError('not_found', 'No group of yours has that id.');
  return c.json(toGroup(row));
});

groups.patch('/groups/:groupId', requireScope('groups.write'), async (c) => {
  const me = caller(c);
  const groupId = c.req.param('groupId');
  const body = await jsonBody(c.req.raw);

  // An allowlist and a shape check per field, for the same reason the profile
  // patch has one: `default_currency` is `character(3)` and `country_code` is
  // `character(2)`, so an over-long value is a Postgres error rather than a
  // refusal anybody can read.
  const patch: Record<string, unknown> = {};
  // A name is optional throughout Waves, so null is a real value here and
  // clearing it is not the same as omitting it.
  if ('name' in body) {
    patch.name = body.name === null ? null : textOrThrow(body.name, 'name', 80);
  }
  if ('type' in body) {
    if (typeof body.type !== 'string' || !GROUP_TYPES.includes(body.type)) {
      throw new ApiError('invalid_request', `type is one of: ${GROUP_TYPES.join(', ')}.`);
    }
    patch.type = body.type;
  }
  if ('cover_emoji' in body) {
    patch.cover_emoji =
      body.cover_emoji === null ? null : textOrThrow(body.cover_emoji, 'cover_emoji', 16);
  }
  if ('simplify_debts' in body)
    patch.simplify_debts = boolOrThrow(body.simplify_debts, 'simplify_debts');
  if ('default_currency' in body) {
    patch.default_currency = currencyOrThrow(body.default_currency, 'default_currency');
  }
  if ('country_code' in body)
    patch.country_code = countryOrThrow(body.country_code, 'country_code');
  if ('start_date' in body) patch.start_date = dateOrThrow(body.start_date, 'start_date');
  if ('end_date' in body) patch.end_date = dateOrThrow(body.end_date, 'end_date');
  if ('archived' in body) {
    patch.archived_at = boolOrThrow(body.archived, 'archived') ? new Date().toISOString() : null;
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiError(
      'invalid_request',
      `Send at least one of: ${EDITABLE.join(', ')}, archived.`,
      {},
      { editable: [...EDITABLE, 'archived'] },
    );
  }

  let query = me.supabase.from('groups').update(patch).eq('id', groupId);
  // `if_revision` makes the write conditional on the row still being the one the
  // caller read. Without it a script that re-sends a whole group object puts its
  // stale currency back over whatever somebody changed in between — a silent
  // revert of another person's work, which is the failure this guard exists for.
  if (body.if_revision !== undefined) {
    if (!Number.isInteger(body.if_revision)) {
      throw new ApiError('invalid_request', 'if_revision is the group revision you last read.');
    }
    query = query.eq('updated_seq', body.if_revision);
  }
  const { data, error } = await query.select(GROUP_COLUMNS);
  if (error) throw error;
  const row = (data ?? [])[0] as unknown as GroupRow | undefined;
  if (!row) {
    throw body.if_revision !== undefined
      ? new ApiError('conflict', 'The group changed since you read it.')
      : new ApiError('not_found', 'No group of yours has that id.');
  }
  return c.json(toGroup(row));
});

groups.delete('/groups/:groupId', requireScope('groups.write'), async (c) => {
  const me = caller(c);
  // Admin-only and settled-only, both decided inside the RPC. A tombstone rather
  // than a row delete: the ledger stays append-only (ADR-004).
  const { error } = await me.supabase.rpc('waves_delete_group', {
    p_group_id: c.req.param('groupId'),
  });
  if (error) throw error;
  c.status(204);
  return c.body(null);
});

groups.get('/groups/:groupId/members', requireScope('groups.read'), async (c) => {
  const me = caller(c);
  const includeLeft = queryFlag(c.req.query('include_left'), 'include_left');
  let query = me.supabase
    .from('group_members')
    .select(MEMBER_COLUMNS)
    .eq('group_id', c.req.param('groupId'))
    .order('created_at', { ascending: true });
  if (!includeLeft) query = query.is('left_at', null);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as MemberRow[];
  return c.json({ data: rows.map(toMember) });
});

groups.post('/groups/:groupId/members', requireScope('groups.write'), async (c) => {
  const me = caller(c);
  const groupId = c.req.param('groupId');
  const body = await jsonBody(c.req.raw);
  const name = textOrThrow(body.name, 'name', 80);

  const mutationId = mutationIdFor(
    me.tokenId,
    `POST /v1/groups/${groupId}/members`,
    c.req.header('Idempotency-Key'),
  );
  const memberId = derivedId(mutationId, 'member');

  // A ghost: a name in the group, with expenses filed against it, that a real
  // person can later claim through an invite (ADR-006). There is no way to add
  // somebody else's *account* to a group from here, and there should not be —
  // joining is something a person does, not something done to them.
  const { error } = await me.supabase.rpc('waves_add_ghost_member', {
    p_group_id: groupId,
    p_name: name,
    p_member_id: memberId,
    p_email: typeof body.email === 'string' ? body.email.trim() || null : null,
    p_phone: typeof body.phone === 'string' ? body.phone.trim() || null : null,
  });
  if (error) throw error;

  const { data } = await me.supabase
    .from('group_members')
    .select(MEMBER_COLUMNS)
    .eq('id', memberId)
    .limit(1);
  const row = (data ?? [])[0] as unknown as MemberRow | undefined;
  if (!row) throw new ApiError('internal', 'The member was added but could not be read back.');
  c.status(201);
  return c.json(toMember(row));
});

groups.patch('/groups/:groupId/members/:memberId', requireScope('groups.write'), async (c) => {
  const me = caller(c);
  const groupId = c.req.param('groupId');
  const memberId = c.req.param('memberId');
  const body = await jsonBody(c.req.raw);

  const wantsRole = 'role' in body;
  const wantsName = 'name' in body;
  if (!wantsRole && !wantsName) {
    throw new ApiError(
      'invalid_request',
      'Send a role, a name, or both.',
      {},
      { editable: ['role', 'name'] },
    );
  }

  // The member is looked up under the group named in the URL before anything is
  // written. `waves_set_member_role` takes only a member id, so without this a
  // member of one group could be promoted through another group's URL. Not an
  // escalation — RLS still decides who may act — but a path segment that
  // silently means nothing is a worse contract than one that is checked, and
  // the DELETE beside this already scopes by group.
  const found = await me.supabase
    .from('group_members')
    .select('id')
    .eq('id', memberId)
    .eq('group_id', groupId)
    .limit(1);
  if (found.error) throw found.error;
  if ((found.data ?? []).length === 0) {
    throw new ApiError('not_found', 'No member of that group has that id.');
  }

  if (wantsRole) {
    if (body.role !== 'admin' && body.role !== 'member') {
      throw new ApiError('invalid_request', 'role is "admin" or "member".');
    }
    // Never a column a client writes: admin-only and the last-admin guard both
    // live in the RPC, and a trigger refuses the direct route.
    const { error } = await me.supabase.rpc('waves_set_member_role', {
      p_member_id: memberId,
      p_role: body.role,
    });
    if (error) throw error;
  }

  if (wantsName) {
    const { error } = await me.supabase
      .from('group_members')
      .update({ ghost_name: textOrThrow(body.name, 'name', 80) })
      .eq('id', memberId)
      .eq('group_id', groupId);
    if (error) throw error;
  }

  const { data } = await me.supabase
    .from('group_members')
    .select(MEMBER_COLUMNS)
    .eq('id', memberId)
    .eq('group_id', groupId)
    .limit(1);
  const row = (data ?? [])[0] as unknown as MemberRow | undefined;
  if (!row) throw new ApiError('not_found', 'No member of that group has that id.');
  return c.json(toMember(row));
});

groups.delete('/groups/:groupId/members/:memberId', requireScope('groups.write'), async (c) => {
  const me = caller(c);
  // A soft exit: the history stays and the balances still count, the person just
  // stops accruing new shares. Removing the row would delete somebody's debts.
  const { data, error } = await me.supabase
    .from('group_members')
    .update({ left_at: new Date().toISOString() })
    .eq('id', c.req.param('memberId'))
    .eq('group_id', c.req.param('groupId'))
    .is('left_at', null)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new ApiError('not_found', 'No member of that group has that id, or they already left.');
  }
  c.status(204);
  return c.body(null);
});

groups.get('/groups/:groupId/balances', requireScope('groups.read'), async (c) => {
  const me = caller(c);
  const { data, error } = await me.supabase
    .from('group_balances')
    .select('group_id, member_id, currency, balance')
    .eq('group_id', c.req.param('groupId'));
  if (error) throw error;
  return c.json({ data: (data ?? []).map((row) => toBalance(row as never)) });
});
