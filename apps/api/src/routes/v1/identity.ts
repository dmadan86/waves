/**
 * Who the token is acting as.
 *
 * The first call every integration makes, and the one that answers the question
 * a developer actually has: not "is this token valid" but "whose account am I
 * about to write to". It reads the profile by id rather than taking whichever
 * single row comes back, because a person can see other people they share a
 * group with and `.single()` over that would be a coin toss.
 */

import { Hono } from 'hono';

import { caller, requireScope, type ApiEnv } from '../../server/authorize';
import { ApiError } from '../../server/errors';
import { countryOrThrow, currencyOrThrow, localeOrThrow, textOrThrow } from '../../server/fields';
import { jsonBody } from '../../server/request';
import { toUser } from '../../server/resources';

const PROFILE_COLUMNS =
  'id, display_name, avatar_url, payment_rail, payment_handle, default_vpa, ' +
  'country_code, default_currency, locale, notification_prefs';

/** The only columns a token may change. Anything else is ignored, not refused. */
const EDITABLE = ['display_name', 'default_currency', 'country_code', 'locale'] as const;

export const identity = new Hono<ApiEnv>();

identity.get('/me', requireScope('identity.read'), async (c) => {
  const me = caller(c);
  const { data, error } = await me.supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', me.profileId)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new ApiError('not_found', 'This account has no profile yet.');
  return c.json(toUser(row as never));
});

identity.patch('/me', requireScope('identity.write'), async (c) => {
  const me = caller(c);
  const body = await jsonBody(c.req.raw);

  // An allowlist, not a filter over the body. Copying whatever arrived into an
  // UPDATE is how a `notification_prefs` or an `id` ends up written by a caller
  // who was only ever asked to be able to change a display name. Each field is
  // checked to its column's own shape — `default_currency` is `character(3)`, so
  // a four-letter code fails in Postgres and reaches a developer as a 500 about
  // somebody else's database unless it is refused here first.
  const patch: Record<string, unknown> = {};
  if ('display_name' in body)
    patch.display_name = textOrThrow(body.display_name, 'display_name', 80);
  if ('default_currency' in body) {
    patch.default_currency = currencyOrThrow(body.default_currency, 'default_currency');
  }
  if ('country_code' in body)
    patch.country_code = countryOrThrow(body.country_code, 'country_code');
  if ('locale' in body) patch.locale = localeOrThrow(body.locale, 'locale');

  if (Object.keys(patch).length === 0) {
    throw new ApiError(
      'invalid_request',
      `Send at least one of: ${EDITABLE.join(', ')}.`,
      {},
      { editable: [...EDITABLE] },
    );
  }

  const { error } = await me.supabase.from('profiles').update(patch).eq('id', me.profileId);
  if (error) throw error;

  const { data } = await me.supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', me.profileId)
    .limit(1);
  const row = data?.[0];
  if (!row) throw new ApiError('not_found', 'This account has no profile yet.');
  return c.json(toUser(row as never));
});
