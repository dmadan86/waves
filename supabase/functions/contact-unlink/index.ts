/**
 * contact-unlink entrypoint — the thin `Deno.serve` shell.
 *
 * All the handling lives in `handler.ts` as a function over injected
 * boundaries, so it can be tested without Deno or a database.
 *
 * `verify_jwt` is left at its default: only somebody signed in can unlink
 * anything, and only from the account they are signed in as.
 */

import { asCaller, asService, serveWithCors } from '../_shared/auth.ts';
import { handleContactUnlink } from './handler.ts';

serveWithCors((request) =>
  handleContactUnlink(request, {
    service: asService,
    // Read through the caller's own token rather than taken from the body, so a
    // request can only ever unlink from the account it is already signed in as.
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
