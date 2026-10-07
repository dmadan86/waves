/**
 * revenuecat-webhook — see handler.ts. This file only wires the real dependencies.
 *
 * Secrets: REVENUECAT_WEBHOOK_SECRET (the Authorization value set on the webhook
 * in RevenueCat). Optional: REVENUECAT_IGNORE_SANDBOX=true to drop sandbox events.
 */

import { asService, errorResponse, serveWithCors } from '../_shared/auth.ts';
import { handleRevenueCatWebhook } from './handler.ts';

serveWithCors(async (request) => {
  try {
    return await handleRevenueCatWebhook(request, {
      env: (name) => Deno.env.get(name),
      service: asService(),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'revenuecat-webhook' });
  }
});
