/**
 * auth-email-send entrypoint — the thin `Deno.serve` shell.
 *
 * All request handling lives in `handler.ts` over injected boundaries so it can
 * be unit-tested without Deno or a Resend account. `serveWithCors` is not used:
 * the caller is GoTrue, server-to-server, never a browser.
 */

import { sendAuthEmail } from '../_shared/email.ts';
import { handleAuthEmailSend } from './handler.ts';

Deno.serve((request) =>
  handleAuthEmailSend(request, {
    send: sendAuthEmail,
    env: (key) => Deno.env.get(key),
  }),
);
