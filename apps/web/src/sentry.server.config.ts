import * as Sentry from '@sentry/nextjs';

import { scrub } from '@waves/core';

import { SENTRY_DATA_COLLECTION } from '@/lib/sentryPrivacy';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_ENV ?? process.env.NODE_ENV,
  dataCollection: SENTRY_DATA_COLLECTION,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  beforeSend: (event) => scrub(event),
});
