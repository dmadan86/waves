/**
 * The consent screen decides two things before it draws anything, and both are
 * security decisions rather than presentation: which query parameter it will
 * trust, and which of two server responses arrived.
 *
 * The screen itself needs a browser, a session and a registered OAuth client to
 * exercise. These do not — which is the reason they were pulled out of it.
 */

import { describe, expect, it } from 'vitest';

import { nextStep, readAuthorizationId } from '@/lib/oauthConsent';

const details = {
  authorization_id: 'auth_123',
  redirect_uri: 'https://agent.example/callback',
  client: { name: 'Someone Else’s Agent', uri: 'https://agent.example' },
  user: { email: 'priya@example.com' },
};

describe('the parameter the page trusts', () => {
  it('reads authorization_id', () => {
    expect(readAuthorizationId(new URLSearchParams('authorization_id=auth_123'))).toBe('auth_123');
  });

  it('treats absent, empty and whitespace alike', () => {
    expect(readAuthorizationId(new URLSearchParams(''))).toBeNull();
    expect(readAuthorizationId(new URLSearchParams('authorization_id='))).toBeNull();
    expect(readAuthorizationId(new URLSearchParams('authorization_id=%20%20'))).toBeNull();
  });

  /**
   * The point of reading exactly one parameter. Supabase decides where the code
   * goes; a `redirect_uri` in this page's own URL is the caller talking, and
   * nothing reads it.
   */
  it('reads nothing else, however inviting', () => {
    const hostile = new URLSearchParams(
      'authorization_id=auth_123&redirect_uri=https://evil.example&state=x&next=https://evil.example',
    );
    expect(readAuthorizationId(hostile)).toBe('auth_123');
  });
});

describe('which response arrived', () => {
  it('forwards when consent was already given', () => {
    const step = nextStep({ redirect_url: 'https://agent.example/callback?code=abc&state=xyz' });
    expect(step).toEqual({
      kind: 'redirect',
      url: 'https://agent.example/callback?code=abc&state=xyz',
    });
  });

  it('asks when there is something to ask', () => {
    const step = nextStep(details);
    expect(step.kind).toBe('consent');
    if (step.kind !== 'consent') return;
    expect(step.pending).toEqual({
      authorizationId: 'auth_123',
      clientName: 'Someone Else’s Agent',
      clientUri: 'https://agent.example',
      redirectUri: 'https://agent.example/callback',
      email: 'priya@example.com',
    });
  });

  /**
   * The narrowing is on the key, not on a truthy `redirect_url`. A details
   * response carrying an empty one must still be a consent screen — read the
   * other way it would be a redirect to nowhere, with the request silently
   * approved-looking and no decision ever shown.
   */
  it('narrows on the key, not on a truthy value', () => {
    const step = nextStep({ ...details, redirect_url: '' } as never);
    expect(step.kind).toBe('consent');
  });
});

describe('the client cannot choose what this screen renders', () => {
  /** An `href` on this origin is script execution, on the one screen where
   *  somebody is deciding whether to trust a stranger. */
  it('drops a javascript: website', () => {
    const step = nextStep({ ...details, client: { name: 'Agent', uri: 'javascript:alert(1)' } });
    expect(step.kind).toBe('consent');
    if (step.kind !== 'consent') return;
    expect(step.pending.clientUri).toBeNull();
  });

  it('drops data:, relative and protocol-relative forms', () => {
    for (const uri of ['data:text/html,<script>', '/phish', '//evil.example', 'mailto:a@b.c']) {
      const step = nextStep({ ...details, client: { name: 'Agent', uri } });
      if (step.kind !== 'consent') throw new Error('expected consent');
      expect(step.pending.clientUri).toBeNull();
    }
  });

  it('keeps a missing website as null rather than inventing one', () => {
    const step = nextStep({ ...details, client: { name: 'Agent', uri: null } });
    if (step.kind !== 'consent') throw new Error('expected consent');
    expect(step.pending.clientUri).toBeNull();
  });

  /**
   * The name is rendered as text, so it needs no filtering — but it must be
   * carried through exactly, including the characters somebody would use to
   * make it look like ours. React escapes it; this asserts nothing "helpfully"
   * rewrites it first.
   */
  it('carries the name through unchanged', () => {
    const step = nextStep({
      ...details,
      client: { name: '<b>Waves</b> Official', uri: 'https://agent.example' },
    });
    if (step.kind !== 'consent') throw new Error('expected consent');
    expect(step.pending.clientName).toBe('<b>Waves</b> Official');
  });
});
