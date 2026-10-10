/**
 * auth-email-send — Supabase's Send Email Hook, which is where this app decides
 * how an Auth email leaves the building.
 *
 * With SMTP, GoTrue builds and sends the message itself and offers no way to
 * add a header. With `[auth.hook.send_email]` pointed here it hands us the code
 * it minted instead, and we send through Resend's HTTP API. The reason to own
 * that step is the `OTP-Token` header (draft-goto-otp-token-01):
 *
 *     OTP-Token: "123456"; origin="https://wavs.co.in"
 *
 * which lets a mail client offer the code for autofill on the named origin only.
 * One header per message, at the top level, never inside a MIME part: Resend's
 * `headers` field is exactly that.
 *
 * Structure mirrors `otp-send`: `verify_jwt = false` (the caller is GoTrue, with
 * no session), the standardwebhooks signature checked first over the raw bytes,
 * and refusals in GoTrue's `{error:{http_code,message}}` envelope.
 *
 * **email_change is the trap.** With Secure Email Change on, GoTrue sends two
 * codes and the docs warn the *hash* field names are reversed. The codes are
 * not: `token` goes to the current address (`user.email`) and `token_new` to
 * the new one (`user.new_email`). See `emailsFor`.
 */

import { verifyWebhookSignature } from '../_shared/core.js';
import type { AuthEmail, AuthEmailResult } from '../_shared/email.ts';
import { hookSecret, readBoundedText } from '../otp-send/handler.ts';

import {
  isCodeAction,
  isNotificationAction,
  renderCodeEmail,
  renderNotificationEmail,
  type Rendered,
} from './content.ts';
import { otpTokenHeader } from './otpTokenHeader.ts';

export const DEFAULT_OTP_TOKEN_ORIGIN = 'https://wavs.co.in';
const MAX_BODY_BYTES = 32 * 1024;

function hookError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface SendEmailHookPayload {
  user?: { email?: string; new_email?: string };
  email_data?: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: string;
    site_url?: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

export interface AuthEmailSendDeps {
  /** Sends one message; wraps Resend. Never throws. */
  send: (message: AuthEmail) => Promise<AuthEmailResult>;
  env: (key: string) => string | undefined;
  verify?: typeof verifyWebhookSignature;
}

export interface PlannedEmail {
  readonly to: string;
  readonly code: string;
  readonly kind: string;
}

/**
 * Which address gets which code for `email_change`.
 *
 * Supabase docs ("Send Email Hook" > Email sending behavior): secure change
 * on => `token` to the current email, `token_new` to the new email (the
 * *hashes* are the reversed pair: `token_hash_new` with `token`, `token_hash`
 * with `token_new`). Secure change off => one email, to the new address, using
 * whichever of the two codes the payload carries.
 */
export function emailsFor(payload: SendEmailHookPayload): PlannedEmail[] {
  const email = payload.user?.email?.trim() ?? '';
  const newEmail = payload.user?.new_email?.trim() ?? '';
  const token = payload.email_data?.token?.trim() ?? '';
  const tokenNew = payload.email_data?.token_new?.trim() ?? '';
  if (token && tokenNew) {
    return [
      ...(email ? [{ to: email, code: token, kind: 'current' }] : []),
      ...(newEmail ? [{ to: newEmail, code: tokenNew, kind: 'new' }] : []),
    ];
  }
  const only = tokenNew || token;
  return newEmail && only ? [{ to: newEmail, code: only, kind: 'new' }] : [];
}

function verifyLink(payload: SendEmailHookPayload, env: AuthEmailSendDeps['env']): string | null {
  const base = env('SUPABASE_URL')?.replace(/\/+$/, '');
  const hash = payload.email_data?.token_hash;
  if (!base || !hash) return null;
  const url = new URL(`${base}/auth/v1/verify`);
  url.searchParams.set('token', hash);
  url.searchParams.set('type', 'invite');
  const redirect = payload.email_data?.redirect_to || payload.email_data?.site_url;
  if (redirect) url.searchParams.set('redirect_to', redirect);
  return url.toString();
}

export async function handleAuthEmailSend(
  request: Request,
  deps: AuthEmailSendDeps,
): Promise<Response> {
  if (request.method !== 'POST') return hookError(405, 'Use POST');

  const secret = deps.env('SEND_EMAIL_HOOK_SECRET');
  if (!secret) return hookError(500, 'SEND_EMAIL_HOOK_SECRET is not set');

  const id = request.headers.get('webhook-id');
  const timestamp = request.headers.get('webhook-timestamp');
  const signature = request.headers.get('webhook-signature');
  if (!id || !timestamp || !signature) return hookError(401, 'Not a signed webhook');

  const body = await readBoundedText(request, MAX_BODY_BYTES);
  if (body === null) return hookError(413, 'That request body is too large');
  const verify = deps.verify ?? verifyWebhookSignature;
  const ok = await verify({ secret: hookSecret(secret), id, timestamp, body, header: signature });
  if (!ok) return hookError(401, 'That signature does not match');

  let payload: SendEmailHookPayload;
  try {
    payload = JSON.parse(body) as SendEmailHookPayload;
  } catch {
    return hookError(400, 'Body is not JSON');
  }

  const action = payload.email_data?.email_action_type ?? '';
  const origin = deps.env('OTP_TOKEN_ORIGIN')?.trim() || DEFAULT_OTP_TOKEN_ORIGIN;

  const outgoing: { to: string; rendered: Rendered; code: string | null }[] = [];

  if (action === 'email_change') {
    const planned = emailsFor(payload);
    if (planned.length === 0) return hookError(400, 'Missing an address or a code');
    for (const p of planned) {
      outgoing.push({
        to: p.to,
        code: p.code,
        rendered: renderCodeEmail('email_change', p.code, {
          newEmail: payload.user?.new_email?.trim() ?? '',
        }),
      });
    }
  } else if (isCodeAction(action)) {
    const to = payload.user?.email?.trim() ?? '';
    const code = payload.email_data?.token?.trim() ?? '';
    if (!to || !code) return hookError(400, 'Missing an address or a code');
    const link = action === 'invite' ? (verifyLink(payload, deps.env) ?? undefined) : undefined;
    outgoing.push({ to, code, rendered: renderCodeEmail(action, code, { link }) });
  } else if (isNotificationAction(action)) {
    const to = payload.user?.email?.trim() ?? '';
    if (!to) return hookError(400, 'Missing an address');
    outgoing.push({ to, code: null, rendered: renderNotificationEmail(action) });
  } else {
    return hookError(400, `Unsupported email_action_type "${action}"`);
  }

  for (const [index, mail] of outgoing.entries()) {
    // Omitted, never fatal, when the code or origin cannot be serialized.
    const header = mail.code === null ? null : otpTokenHeader(mail.code, origin);
    const result = await deps.send({
      to: mail.to,
      subject: mail.rendered.subject,
      html: mail.rendered.html,
      text: mail.rendered.text,
      headers: header === null ? {} : { 'OTP-Token': header },
      // GoTrue redelivers with the same webhook-id; a retry must not double-send.
      key: `auth-email:${id}:${index}`,
    });
    if (!result.ok) {
      console.error('auth-email-send failed:', result.error);
      // The provider's text stays in the logs; GoTrue shows this to the person.
      return hookError(500, 'The email could not be sent');
    }
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
