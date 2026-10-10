/**
 * Coverage for auth-email-send — the Send Email Hook that sends every Auth mail
 * through Resend with an `OTP-Token` header (draft-goto-otp-token-01).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendAuthEmail, type AuthEmail, type AuthEmailResult } from '../_shared/email.ts';

import { emailsFor, handleAuthEmailSend, type AuthEmailSendDeps } from './handler.ts';

const TEST_HOOK_SECRET = `v1,whsec_${Buffer.from('test').toString('base64')}`;

const ENV: Record<string, string> = {
  SEND_EMAIL_HOOK_SECRET: TEST_HOOK_SECRET,
  SUPABASE_URL: 'https://proj.supabase.co',
};

function request(payload: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://edge.test/auth-email-send', {
    method: 'POST',
    headers: {
      'webhook-id': 'msg_1',
      'webhook-timestamp': '1700000000',
      'webhook-signature': 'v1,sig',
      ...headers,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

function hook(
  action: string,
  user: Record<string, string> = { email: 'a@example.com' },
  data: Record<string, string> = {},
) {
  return {
    user,
    email_data: {
      token: '111111',
      token_hash: 'hash-a',
      redirect_to: 'waves://auth',
      email_action_type: action,
      site_url: 'https://proj.supabase.co',
      token_new: '',
      token_hash_new: '',
      ...data,
    },
  };
}

function deps(
  o: { verified?: boolean; result?: AuthEmailResult; env?: Record<string, string> } = {},
): AuthEmailSendDeps & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn((_m: AuthEmail) => Promise.resolve(o.result ?? { ok: true as const }));
  const env = { ...ENV, ...(o.env ?? {}) };
  return {
    send,
    env: (k: string) => env[k],
    verify: () => Promise.resolve(o.verified ?? true),
  };
}

const sent = (d: { send: ReturnType<typeof vi.fn> }): AuthEmail[] =>
  d.send.mock.calls.map((c) => c[0] as AuthEmail);

describe('signature and envelope', () => {
  it('answers a bad signature with 401 in the GoTrue envelope, sending nothing', async () => {
    const d = deps({ verified: false });
    const res = await handleAuthEmailSend(request(hook('signup')), d);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { http_code: 401, message: 'That signature does not match' },
    });
    expect(d.send).not.toHaveBeenCalled();
  });

  it('refuses unsigned requests and a missing secret', async () => {
    const d = deps();
    const bare = new Request('https://edge.test/x', { method: 'POST', body: '{}' });
    expect((await handleAuthEmailSend(bare, d)).status).toBe(401);
    expect(
      (
        await handleAuthEmailSend(
          request(hook('signup')),
          deps({ env: { SEND_EMAIL_HOOK_SECRET: '' } }),
        )
      ).status,
    ).toBe(500);
    expect((await handleAuthEmailSend(new Request('https://x', { method: 'GET' }), d)).status).toBe(
      405,
    );
  });

  it('checks the signature before reading the payload', async () => {
    const res = await handleAuthEmailSend(request('not json'), deps({ verified: false }));
    expect(res.status).toBe(401);
    expect((await handleAuthEmailSend(request('not json'), deps())).status).toBe(400);
  });

  it('turns a Resend failure into a GoTrue error envelope without leaking the provider text', async () => {
    const d = deps({ result: { ok: false, error: '422 validation_error secret detail' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await handleAuthEmailSend(request(hook('magiclink')), d);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { http_code: number; message: string } };
    expect(body.error.http_code).toBe(500);
    expect(body.error.message).not.toContain('secret detail');
  });

  it('rejects an unknown action type', async () => {
    expect((await handleAuthEmailSend(request(hook('weird')), deps())).status).toBe(400);
  });
});

describe('each action type', () => {
  const cases: [string, string][] = [
    ['signup', '111111 is your Waves sign-up code'],
    ['magiclink', '111111 is your Waves verification code'],
    ['recovery', '111111 is your Waves password reset code'],
    ['reauthentication', '111111 is your Waves confirmation code'],
    ['invite', '111111 is your Waves invitation code'],
  ];

  it.each(cases)(
    '%s: right recipient, subject, header and visible code',
    async (action, subject) => {
      const d = deps();
      const res = await handleAuthEmailSend(request(hook(action)), d);
      expect(res.status).toBe(200);
      const [mail, ...rest] = sent(d);
      expect(rest).toHaveLength(0);
      expect(mail.to).toBe('a@example.com');
      expect(mail.subject).toBe(subject);
      expect(mail.headers).toEqual({ 'OTP-Token': '"111111"; origin="https://wavs.co.in"' });
      expect(mail.html).toContain('>111111<');
      expect(mail.text).toContain('111111');
      expect(mail.key).toBe('auth-email:msg_1:0');
    },
  );

  it('invite also carries the accept link', async () => {
    const d = deps();
    await handleAuthEmailSend(request(hook('invite')), d);
    expect(sent(d)[0].html).toContain('https://proj.supabase.co/auth/v1/verify?token=hash-a');
    expect(sent(d)[0].text).toContain('type=invite');
  });

  it('other code mails do not link', async () => {
    const d = deps();
    await handleAuthEmailSend(request(hook('magiclink')), d);
    expect(sent(d)[0].html).not.toContain('<a ');
  });

  it('security notifications send without an OTP-Token header', async () => {
    const d = deps();
    const res = await handleAuthEmailSend(request(hook('password_changed_notification')), d);
    expect(res.status).toBe(200);
    expect(sent(d)[0].headers).toEqual({});
    expect(sent(d)[0].subject).toBe('Your Waves password was changed');
  });

  it('honours OTP_TOKEN_ORIGIN', async () => {
    const d = deps({ env: { OTP_TOKEN_ORIGIN: 'https://staging.wavs.co.in' } });
    await handleAuthEmailSend(request(hook('signup')), d);
    expect(sent(d)[0].headers['OTP-Token']).toBe('"111111"; origin="https://staging.wavs.co.in"');
  });

  it('omits the header, but still sends, for an invalid origin or an unserializable code', async () => {
    const bad = deps({ env: { OTP_TOKEN_ORIGIN: 'http://wavs.co.in/path' } });
    expect((await handleAuthEmailSend(request(hook('signup')), bad)).status).toBe(200);
    expect(sent(bad)[0].headers).toEqual({});

    const odd = deps();
    await handleAuthEmailSend(request(hook('signup', undefined, { token: '12é56' })), odd);
    expect(sent(odd)).toHaveLength(1);
    expect(sent(odd)[0].headers).toEqual({});
  });

  it('escapes the new address in the email_change copy', async () => {
    const d = deps();
    await handleAuthEmailSend(
      request(hook('email_change', { email: 'a@example.com', new_email: '<b>@example.com' })),
      d,
    );
    expect(sent(d)[0].html).not.toContain('<b>@example.com');
  });
});

describe('email_change', () => {
  const secure = hook(
    'email_change',
    { email: 'old@example.com', new_email: 'new@example.com' },
    {
      token: '111111',
      token_hash: 'hash-for-new',
      token_new: '222222',
      token_hash_new: 'hash-for-old',
    },
  );

  it('secure change: token to the CURRENT address, token_new to the NEW one, each with its own header', async () => {
    const d = deps();
    expect((await handleAuthEmailSend(request(secure), d)).status).toBe(200);
    const mails = sent(d);
    expect(mails).toHaveLength(2);

    expect(mails[0].to).toBe('old@example.com');
    expect(mails[0].headers['OTP-Token']).toBe('"111111"; origin="https://wavs.co.in"');
    expect(mails[0].subject).toBe('111111 is your code to confirm your new Waves email');

    expect(mails[1].to).toBe('new@example.com');
    expect(mails[1].headers['OTP-Token']).toBe('"222222"; origin="https://wavs.co.in"');
    expect(mails[1].subject).toContain('222222');

    expect(mails[0].html).not.toContain('222222');
    expect(mails[1].html).not.toContain('111111');
    expect(new Set(mails.map((m) => m.key)).size).toBe(2);
  });

  it('secure change off: one email to the new address, whichever code is present', async () => {
    for (const data of [{ token: '333333' }, { token: '', token_new: '444444' }]) {
      const d = deps();
      await handleAuthEmailSend(
        request(
          hook('email_change', { email: 'old@example.com', new_email: 'new@example.com' }, data),
        ),
        d,
      );
      expect(sent(d)).toHaveLength(1);
      expect(sent(d)[0].to).toBe('new@example.com');
      expect(sent(d)[0].headers['OTP-Token']).toContain(data.token_new ?? data.token);
    }
  });

  it('stops after the first failure so a retry does not double-send', async () => {
    const d = deps({ result: { ok: false, error: 'boom' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await handleAuthEmailSend(request(secure), d)).status).toBe(500);
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it('emailsFor pairs addresses and codes', () => {
    expect(emailsFor(secure)).toEqual([
      { to: 'old@example.com', code: '111111', kind: 'current' },
      { to: 'new@example.com', code: '222222', kind: 'new' },
    ]);
  });
});

describe('sendAuthEmail through Resend', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('posts the header at the top level of the Resend request, from the Waves sender', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{"id":"em_1"}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendAuthEmail({
      to: 'a@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
      headers: { 'OTP-Token': '"123456"; origin="https://wavs.co.in"' },
      key: 'k1',
    });
    expect(res).toEqual({ ok: true, messageId: 'em_1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.from).toBe('Waves <hello@wavs.co.in>');
    expect(sentBody.headers).toEqual({ 'OTP-Token': '"123456"; origin="https://wavs.co.in"' });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('k1');
  });

  it('reports a Resend rejection and a missing key as failures, not throws', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('{"name":"validation_error","message":"bad"}', { status: 422 }),
        ),
      ),
    );
    const msg = { to: 'a@b.c', subject: 's', html: 'h', text: 't', headers: {}, key: 'k' };
    expect((await sendAuthEmail(msg)).ok).toBe(false);
    vi.stubEnv('RESEND_API_KEY', '');
    expect((await sendAuthEmail(msg)).ok).toBe(false);
  });
});
