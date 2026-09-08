/**
 * The parts of the developer console that are decisions rather than markup.
 *
 * Two of these are load-bearing for something other than tidiness. The refusal
 * unpacking is what lets the pages show the API's own sentence and *only* the
 * API's own sentence — a shape it does not recognise has to come back null, so
 * the page falls through to its translated fallback rather than rendering
 * whatever happened to be in the body. And the consent parser is the gate in
 * front of the Approve button: a request missing a parameter, or carrying a
 * challenge that is not a base64url SHA-256, can only ever be refused by the
 * server, so the screen must not offer to approve it.
 */

import { describe, expect, it } from 'vitest';

import {
  DeveloperApiError,
  apiBase,
  formatDay,
  isSignedOut,
  isUnconfigured,
  messageFromBody,
  readConsentQuery,
  serverSentence,
  splitRedirectUris,
  tokenState,
} from '../src/lib/developerApi';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('where the API lives', () => {
  it('is null when nothing was configured, rather than a broken URL', () => {
    expect(apiBase(undefined)).toBeNull();
    expect(apiBase('')).toBeNull();
    expect(apiBase('   ')).toBeNull();
  });

  it('drops the trailing slash so a path never doubles it', () => {
    expect(apiBase('https://api.waves.app/')).toBe('https://api.waves.app');
    expect(apiBase('https://api.waves.app///')).toBe('https://api.waves.app');
    expect(apiBase('  https://api.waves.app  ')).toBe('https://api.waves.app');
  });
});

describe('the two error shapes this service speaks', () => {
  it('reads the API’s own envelope', () => {
    expect(
      messageFromBody({
        error: {
          code: 'invalid_request',
          message: 'that redirect address is not registered',
          request_id: 'req_1',
        },
      }),
    ).toEqual({
      code: 'invalid_request',
      message: 'that redirect address is not registered',
      requestId: 'req_1',
    });
  });

  it('reads RFC 6749’s flatter one, where `error` is a bare string', () => {
    expect(
      messageFromBody({ error: 'invalid_grant', error_description: 'that code is spent' }),
    ).toEqual({ code: 'invalid_grant', message: 'that code is spent', requestId: null });
  });

  it('refuses to invent a sentence out of a body it does not recognise', () => {
    // Anything here would end up rendered at somebody as an explanation.
    expect(messageFromBody(null)).toBeNull();
    expect(messageFromBody('<html>502</html>')).toBeNull();
    expect(messageFromBody({ message: 'permission denied for table api_tokens' })).toBeNull();
  });
});

describe('what reaches the page', () => {
  it('passes on the server’s sentence and nothing else', () => {
    const refusal = new DeveloperApiError(
      'not_found',
      'No live token of yours has that id.',
      404,
      null,
    );
    expect(serverSentence(refusal)).toBe('No live token of yours has that id.');
    // Not ours: a stack, a Postgres message, a thrown string — no sentence.
    expect(serverSentence(new TypeError('Failed to fetch'))).toBeUndefined();
    expect(serverSentence('boom')).toBeUndefined();
    // Ours, but wordless (no session, no configured API): the caller's own
    // translated fallback stands.
    expect(serverSentence(new DeveloperApiError('unauthorized', '', 401, null))).toBeUndefined();
  });

  it('knows a stale session from a refused request, on either surface', () => {
    // `/developer/*` says it one way, `POST /oauth/authorize` says it in RFC
    // 6749's vocabulary; both mean "sign in again", and neither means the
    // application did anything wrong.
    for (const code of ['unauthorized', 'invalid_token', 'invalid_grant']) {
      expect(isSignedOut(new DeveloperApiError(code, 'sign in', 401, null)), code).toBe(true);
    }
    for (const code of ['invalid_request', 'not_found', 'server_error', 'unconfigured']) {
      expect(isSignedOut(new DeveloperApiError(code, 'no', 400, null)), code).toBe(false);
    }
    expect(isSignedOut(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('names the deployment with no developer API', () => {
    expect(isUnconfigured(new DeveloperApiError('unconfigured', '', 0, null))).toBe(true);
    expect(isUnconfigured(new DeveloperApiError('not_found', 'nope', 404, null))).toBe(false);
    expect(isUnconfigured(new Error('unconfigured'))).toBe(false);
  });
});

describe('redirect addresses, as typed', () => {
  it('takes one per line, ignoring blanks and stray spaces', () => {
    expect(splitRedirectUris('  https://a.example/cb \n\n https://b.example/cb\n')).toEqual([
      'https://a.example/cb',
      'https://b.example/cb',
    ]);
  });

  it('collapses a repeat rather than registering it twice', () => {
    expect(splitRedirectUris('https://a.example/cb\nhttps://a.example/cb')).toEqual([
      'https://a.example/cb',
    ]);
  });

  it('is empty when nothing was typed', () => {
    expect(splitRedirectUris('\n  \n')).toEqual([]);
  });
});

describe('the authorization request in the URL', () => {
  const query = (extra: Record<string, string> = {}, drop?: string) => {
    const params: Record<string, string> = {
      client_id: 'waves_app_123',
      redirect_uri: 'https://app.example/cb',
      scope: 'groups.read expenses.read',
      code_challenge: CHALLENGE,
      ...extra,
    };
    if (drop) delete params[drop];
    return new URLSearchParams(params);
  };

  it('reads a complete request, keeping the scope string verbatim', () => {
    const consent = readConsentQuery(query({ state: 'xyz' }));
    expect(consent).toEqual({
      clientId: 'waves_app_123',
      redirectUri: 'https://app.example/cb',
      scope: 'groups.read expenses.read',
      scopes: ['groups.read', 'expenses.read'],
      codeChallenge: CHALLENGE,
      state: 'xyz',
    });
  });

  it('treats a missing state as absent, not as a value', () => {
    expect(readConsentQuery(query())?.state).toBeNull();
  });

  it('refuses anything the server would refuse anyway', () => {
    for (const missing of ['client_id', 'redirect_uri', 'scope', 'code_challenge']) {
      expect(readConsentQuery(query({}, missing)), missing).toBeNull();
    }
    expect(readConsentQuery(query({ scope: '   ' }))).toBeNull();
    // `plain` is a challenge whoever can read the request can also answer.
    expect(readConsentQuery(query({ code_challenge: 'a-verifier-not-a-digest' }))).toBeNull();
    expect(readConsentQuery(query({ code_challenge: `${CHALLENGE}=` }))).toBeNull();
  });
});

describe('whether a token still works', () => {
  const now = new Date('2026-09-08T12:00:00Z');

  it('is revoked the moment it was revoked, expiry or no expiry', () => {
    expect(tokenState({ revoked_at: '2026-09-01T00:00:00Z', expires_at: null }, now)).toBe(
      'revoked',
    );
  });

  it('is expired once the moment has passed', () => {
    expect(tokenState({ revoked_at: null, expires_at: '2026-09-07T00:00:00Z' }, now)).toBe(
      'expired',
    );
    expect(tokenState({ revoked_at: null, expires_at: '2026-09-09T00:00:00Z' }, now)).toBe('live');
  });

  it('lives forever when it was given no expiry', () => {
    expect(tokenState({ revoked_at: null, expires_at: null }, now)).toBe('live');
  });
});

describe('saying when', () => {
  it('formats for the reader’s locale', () => {
    expect(formatDay('en-GB', '2026-09-08T12:00:00Z')).toContain('2026');
    // Arabic-Indic digits where the locale asks for them.
    expect(formatDay('ar-EG', '2026-09-08T12:00:00Z')).toMatch(/[٠-٩]/);
  });

  it('says nothing at all rather than "Invalid Date"', () => {
    expect(formatDay('en', null)).toBe('');
    expect(formatDay('en', '')).toBe('');
    expect(formatDay('en', 'not a date')).toBe('');
  });

  it('survives a locale tag the browser sent and Intl rejects', () => {
    expect(formatDay('en-GB-oed-x-', '2026-09-08T12:00:00Z')).toContain('2026');
  });
});
