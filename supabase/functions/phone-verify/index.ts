/**
 * phone-verify entrypoint — the thin `Deno.serve` shell.
 *
 * All the handling lives in `handler.ts` as a function over injected
 * boundaries, so it can be tested without Deno, a database or Firebase.
 *
 * `verify_jwt = false`: the caller has no Supabase session yet — getting one is
 * the entire point of the call. What it carries instead is a Firebase ID token,
 * checked against Google's published signing keys before anything else happens.
 */

import { asService } from '../_shared/auth.ts';
import { handlePhoneVerify } from './handler.ts';

Deno.serve((request) =>
  handlePhoneVerify(request, {
    service: asService,
    fetchImpl: fetch,
    env: (key) => Deno.env.get(key),
  }),
);
