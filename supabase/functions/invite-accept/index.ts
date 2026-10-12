/**
 * invite-accept entrypoint — the thin `Deno.serve` shell.
 *
 * The handling is a function over injected boundaries in `handler.ts`, so it is
 * unit-tested without Deno or a network (`handler.test.ts`).
 */

import { asCaller, asService, serveWithCors } from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { handleInviteAccept } from './handler.ts';

serveWithCors((request) => handleInviteAccept(request, { asCaller, asService, enforceRateLimit }));
