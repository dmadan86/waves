/** two-step-authenticator entrypoint: wires the real clients into `handler.ts` (tested in `handler.test.ts`). */

import { asCaller, asService, serveWithCors } from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { handleTwoStepAuthenticator } from './handler.ts';

serveWithCors((request) =>
  handleTwoStepAuthenticator(request, {
    asCaller,
    asService,
    env: (name) => Deno.env.get(name),
    fetchImpl: fetch,
    now: () => Date.now(),
    rateLimit: (service, req, profileId) => enforceRateLimit(service, req, 'two-step', profileId),
  }),
);
