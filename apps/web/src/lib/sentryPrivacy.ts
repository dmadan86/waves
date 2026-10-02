/**
 * What the Sentry SDK may collect on its own, in every runtime (browser,
 * server, edge).
 *
 * Sentry 11 replaced the single `sendDefaultPii: false` switch with this
 * per-category `dataCollection`, and its defaults collect *more* than the old
 * switch allowed — user fields, cookies, headers, request and response bodies.
 * Dropping the old line would have quietly started sending those. So every
 * category is turned off here, explicitly, matching what `sendDefaultPii:
 * false` meant before: an error report says where the code broke, never who it
 * broke for or what they were sending. `scrub` (from @waves/core) still runs
 * over every event in `beforeSend` as the second line.
 *
 * `stackFrameVariables` is off too: local variables in this app are amounts,
 * names and emails as often as anything else.
 */
import type * as Sentry from '@sentry/nextjs';

type DataCollection = NonNullable<Parameters<typeof Sentry.init>[0]>['dataCollection'];

export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};
