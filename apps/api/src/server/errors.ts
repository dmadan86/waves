/**
 * One shape for every refusal.
 *
 * The edge functions answer `{ code, message }` at the top level, and this is
 * deliberately one step away from that: a public API's error has to be
 * impossible to mistake for a resource. `{ "error": { … } }` can never collide
 * with an expense that happens to have a `message`, and a client can branch on
 * `"error" in body` without knowing which endpoint it called. The codes
 * themselves are the same vocabulary the rest of the server speaks, lowercased,
 * because a developer reading a 403 wants a token to match on, not a sentence
 * to parse.
 *
 * Nothing internal comes out of here. A Postgres message, a stack, a token, a
 * hostname — none of it reaches a caller who is, by construction, a stranger.
 * `fromUnknown` is where that rule is enforced, and it is the only path an
 * unplanned exception can take to the wire.
 */

export type ErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'invalid_token'
  | 'insufficient_scope'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'rate_limited'
  | 'misconfigured'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  invalid_token: 401,
  insufficient_scope: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  misconfigured: 500,
  internal: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** Extra response headers. `Retry-After` and `WWW-Authenticate` use it. */
    readonly headers: Record<string, string> = {},
    /** Field-level detail, when naming the field is what makes the 400 useful. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/**
 * The refusals the database raises, translated.
 *
 * Every RPC in this repo raises `CODE: a human sentence` (ADR-013's house
 * style), so the code is machine-readable and the sentence was written for a
 * person. Both are safe to forward — they are the server's own words about the
 * caller's own request. Anything that does not match that shape is treated as
 * an internal fault and says nothing.
 */
const RAISED = /^([A-Z][A-Z0-9_]{2,}):\s*(.+)$/;

/**
 * The codes worth forwarding, and only those.
 *
 * Every entry here is a refusal the *caller* can act on: a permission they do
 * not have, a rule they broke, a row that is not theirs. Anything raised by an
 * RPC and missing from this table falls through to a bare 500 — which is the
 * safe default, and the reason to keep the table honest rather than to widen it
 * with a regex. A code that reaches a stranger is part of the public contract.
 */
const RAISED_CODES: Record<string, { code: ErrorCode; retry?: boolean }> = {
  NOT_SIGNED_IN: { code: 'unauthorized' },
  NOT_AUTHENTICATED: { code: 'unauthorized' },
  INVALID_TOKEN: { code: 'invalid_token' },
  TOKEN_REVOKED: { code: 'invalid_token' },
  TOKEN_EXPIRED: { code: 'invalid_token' },
  WRONG_TOKEN_KIND: { code: 'invalid_token' },
  APP_DISABLED: { code: 'invalid_token' },
  INSUFFICIENT_SCOPE: { code: 'insufficient_scope' },
  NOT_A_MEMBER: { code: 'forbidden' },
  NOT_A_PARTY: { code: 'forbidden' },
  NOT_OWNER: { code: 'forbidden' },
  NOT_YOURS: { code: 'forbidden' },
  NOT_THE_PAYEE: { code: 'forbidden' },
  NOT_THE_PAYER: { code: 'forbidden' },
  NOT_THE_AUTHOR: { code: 'forbidden' },
  NOT_ADMIN: { code: 'forbidden' },
  NOT_AN_ADMIN: { code: 'forbidden' },
  ADMIN_ONLY: { code: 'forbidden' },
  GHOST_CANNOT_ADMIN: { code: 'unprocessable' },
  LAST_ADMIN: { code: 'unprocessable' },
  NOT_SETTLED: { code: 'unprocessable' },
  CANNOT_DELETE: { code: 'unprocessable' },
  RESTORE_WINDOW_EXPIRED: { code: 'unprocessable' },
  GUEST_GROUP_LIMIT: { code: 'forbidden' },
  NOTHING_OWED: { code: 'unprocessable' },
  INVALID_TRANSITION: { code: 'conflict' },
  INVALID_ROLE: { code: 'invalid_request' },
  INVALID_CATEGORY: { code: 'invalid_request' },
  INVALID_STATUS: { code: 'invalid_request' },
  NAME_REQUIRED: { code: 'invalid_request' },
  PHONE_NEEDS_COUNTRY_CODE: { code: 'invalid_request' },
  UNKNOWN_MEMBER: { code: 'invalid_request' },
  UNKNOWN_EXPENSE: { code: 'not_found' },
  NOT_FOUND: { code: 'not_found' },
  WRONG_GROUP: { code: 'invalid_request' },
  GROUP_EXISTS: { code: 'conflict' },
  // The AI-agent ceilings apply to any non-app caller that carries a client id,
  // which a third-party token can (TDR §9, `waves_assert_agent_cap`).
  AGENT_CAP_SINGLE: { code: 'forbidden' },
  AGENT_CAP_DAILY: { code: 'forbidden' },
  NO_SUCH_APP: { code: 'not_found' },
  UNKNOWN_CLIENT: { code: 'invalid_request' },
  BAD_REDIRECT: { code: 'invalid_request' },
  SCOPE_NOT_ALLOWED: { code: 'invalid_request' },
  BAD_CLIENT_SECRET: { code: 'unauthorized' },
  INVALID_GRANT: { code: 'unauthorized' },
  APP_ID_TAKEN: { code: 'conflict' },
  TOKEN_ID_TAKEN: { code: 'conflict' },
  APP_LIMIT: { code: 'unprocessable' },
  TOKEN_LIMIT: { code: 'unprocessable' },
  TOKEN_TTL: { code: 'invalid_request' },
  SHARE_MISMATCH: { code: 'conflict' },
  PAYER_MISMATCH: { code: 'invalid_request' },
  INVALID_AMOUNT: { code: 'invalid_request' },
  INVALID_SPLIT_PARAMS: { code: 'invalid_request' },
  STALE_REVISION: { code: 'conflict' },
  RATE_LIMITED: { code: 'rate_limited', retry: true },
  GUEST_TRIAL_EXPIRED: { code: 'forbidden' },
};

/**
 * Postgres states that mean "the request was malformed", not "we broke".
 *
 * A caller who puts `not-a-uuid` in a path segment reaches PostgREST, which
 * raises `22P02`. That is a 400 in every sense — the caller can fix it, and
 * nobody needs to look at a log — but it carries no `CODE:` prefix, so without
 * this table it would be swallowed as an internal fault and answered 500 on
 * every id-taking route in the API.
 */
const SQLSTATE: Record<string, ErrorCode> = {
  '22P02': 'invalid_request', // invalid text representation (a bad uuid, mostly)
  '22003': 'invalid_request', // numeric value out of range
  '22007': 'invalid_request', // invalid datetime format
  '22001': 'invalid_request', // value too long for the column
  '23514': 'unprocessable', // a CHECK constraint said no
  '23505': 'conflict', // unique violation
  '23503': 'invalid_request', // a foreign key that names nothing
  '42501': 'forbidden', // insufficient privilege — RLS or a missing grant
};

export function fromUnknown(caught: unknown): ApiError {
  if (caught instanceof ApiError) return caught;

  const sqlstate =
    typeof caught === 'object' && caught !== null && 'code' in caught
      ? String((caught as { code: unknown }).code)
      : '';
  const mapped = SQLSTATE[sqlstate];
  if (mapped) {
    // The database's own sentence is not shown: it names columns and
    // constraints that are ours, not the caller's. The status is the message.
    return new ApiError(
      mapped,
      mapped === 'forbidden'
        ? 'You do not have access to that.'
        : 'That request could not be applied — check the ids and values you sent.',
    );
  }

  const raw =
    caught instanceof Error
      ? caught.message
      : typeof caught === 'object' && caught !== null && 'message' in caught
        ? String((caught as { message: unknown }).message)
        : '';

  const match = RAISED.exec(raw.trim());
  const known = match ? RAISED_CODES[match[1] as string] : undefined;
  if (match && known) {
    return new ApiError(known.code, match[2] as string);
  }

  // Not something the server chose to say. It goes in the log and the caller is
  // told only that it happened — the alternative is publishing whichever
  // internal detail happened to be in the exception.
  console.error('unhandled api error:', raw || caught);
  return new ApiError('internal', 'Something went wrong on our side.');
}

export function errorBody(
  error: ApiError,
  requestId: string,
): {
  error: { code: string; message: string; request_id: string; details?: Record<string, unknown> };
} {
  return {
    error: {
      code: error.code,
      message: error.message,
      request_id: requestId,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}
