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

import { asCaller, asService } from '../_shared/auth.ts';
import { handlePhoneVerify } from './handler.ts';

Deno.serve((request) =>
  handlePhoneVerify(request, {
    service: asService,
    fetchImpl: fetch,
    env: (key) => Deno.env.get(key),
    // Who is asking, when they are asking to *attach* a number. Read through
    // the caller's own token rather than taken from the body, so a request can
    // only ever add a number to the account it is already signed in as.
    callerId: async (incoming) => {
      try {
        const { data } = await asCaller(incoming).auth.getUser();
        return data.user?.id ?? null;
      } catch {
        return null;
      }
    },
  }),
);
