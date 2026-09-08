/**
 * Money that has actually moved between two people — or says it has.
 *
 * Recording a settlement is not performing one (ADR-007). It is a claim, made
 * real only when whoever was paid confirms it, and a token with
 * `settlements.write` can make the claim and confirm the ones addressed to its
 * owner. It cannot confirm somebody else's: `waves_confirm_settlement` checks
 * that the caller is the payee, server-side, and this file does not repeat the
 * check because a second copy could only disagree with the first.
 *
 * The idempotency key matters more here than anywhere else in the API. A retried
 * "I paid them" that recorded twice would take a real debt to a negative
 * balance, so `client_mutation_id` is required by the RPC rather than defaulted,
 * and it is derived from the caller's `Idempotency-Key` so a retry is the same
 * key and a new payment is a new one.
 */

import { Hono } from 'hono';
import type { Settlement } from '@waves/api-client';

import { caller, requireScope, type ApiEnv } from '../../server/authorize';
import { ApiError } from '../../server/errors';
import {
  decodeCursor,
  jsonBody,
  keysetFilter,
  mutationIdFor,
  pageSize,
  toPage,
} from '../../server/request';
import { toSettlement } from '../../server/resources';

/**
 * The settlement lifecycle (ADR-007). A filter on anything else is a mistake,
 * and an empty page is the one answer that would not say so.
 */
const STATUSES = ['initiated', 'confirmed', 'auto_confirmed', 'disputed', 'cancelled'];

const SETTLEMENT_COLUMNS = `
  id, group_id, from_member_id, to_member_id, currency, amount, status,
  initiated_at, confirmed_at
`;

export const settlements = new Hono<ApiEnv>();

settlements.get('/settlements', requireScope('settlements.read'), async (c) => {
  const me = caller(c);
  const limit = pageSize(c.req.query('limit'));
  const cursor = decodeCursor(c.req.query('cursor'));
  const groupId = c.req.query('group_id');
  const status = c.req.query('status');

  let query = me.supabase
    .from('settlements')
    .select(SETTLEMENT_COLUMNS)
    .order('initiated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (groupId) query = query.eq('group_id', groupId);
  if (status) {
    if (!STATUSES.includes(status)) {
      throw new ApiError('invalid_request', `status is one of: ${STATUSES.join(', ')}.`);
    }
    query = query.eq('status', status);
  }
  if (cursor) query = query.or(keysetFilter(cursor, 'initiated_at'));

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as Settlement[];
  return c.json(
    toPage(rows.map(toSettlement), limit, (row) => ({ key: row.initiated_at, id: row.id })),
  );
});

settlements.get('/settlements/:settlementId', requireScope('settlements.read'), async (c) => {
  const me = caller(c);
  const { data, error } = await me.supabase
    .from('settlements')
    .select(SETTLEMENT_COLUMNS)
    .eq('id', c.req.param('settlementId'))
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as unknown as Settlement | undefined;
  if (!row) throw new ApiError('not_found', 'No settlement you can see has that id.');
  return c.json(toSettlement(row));
});

settlements.post('/settlements', requireScope('settlements.write'), async (c) => {
  const me = caller(c);
  const body = await jsonBody(c.req.raw);

  const groupId = typeof body.group_id === 'string' ? body.group_id : '';
  const fromMemberId = typeof body.from_member_id === 'string' ? body.from_member_id : '';
  const toMemberId = typeof body.to_member_id === 'string' ? body.to_member_id : '';
  if (!groupId || !fromMemberId || !toMemberId) {
    throw new ApiError(
      'invalid_request',
      'group_id, from_member_id and to_member_id say who paid whom, and where.',
    );
  }
  if (fromMemberId === toMemberId) {
    throw new ApiError('invalid_request', 'A payment needs two different people.');
  }
  const amount = typeof body.amount === 'string' ? body.amount : '';
  if (!/^\d{1,19}$/.test(amount) || BigInt(amount) <= 0n) {
    throw new ApiError(
      'invalid_request',
      'amount is a positive whole number of minor units, as a string.',
    );
  }

  // The finer rail, not the coarse enum. A rail the enum never heard of — Pix,
  // PayNow, Wise — still records, because the RPC derives the enum from it.
  const rail = typeof body.rail === 'string' && body.rail.trim() ? body.rail.trim() : 'cash';

  const settlementId = await me.waves.recordSettlement({
    groupId,
    fromMemberId,
    toMemberId,
    amount: BigInt(amount),
    rail,
    currency: typeof body.currency === 'string' ? body.currency : null,
    note: typeof body.note === 'string' ? body.note : null,
    clientMutationId: mutationIdFor(
      me.tokenId,
      'POST /v1/settlements',
      c.req.header('Idempotency-Key'),
    ),
  });

  const { data } = await me.supabase
    .from('settlements')
    .select(SETTLEMENT_COLUMNS)
    .eq('id', settlementId)
    .limit(1);
  const row = (data ?? [])[0] as unknown as Settlement | undefined;
  if (!row) throw new ApiError('internal', 'The payment was recorded but could not be read back.');
  c.status(201);
  return c.json(toSettlement(row));
});

settlements.post(
  '/settlements/:settlementId/confirm',
  requireScope('settlements.write'),
  async (c) => {
    const me = caller(c);
    const settlementId = c.req.param('settlementId');
    // "Yes, that reached me." Only the payee may say it, and the RPC is where that
    // is decided.
    const { error } = await me.supabase.rpc('waves_confirm_settlement', {
      p_settlement_id: settlementId,
    });
    if (error) throw error;

    const { data } = await me.supabase
      .from('settlements')
      .select(SETTLEMENT_COLUMNS)
      .eq('id', settlementId)
      .limit(1);
    const row = (data ?? [])[0] as unknown as Settlement | undefined;
    if (!row) throw new ApiError('not_found', 'No settlement you can see has that id.');
    return c.json(toSettlement(row));
  },
);
