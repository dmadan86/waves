import { asService, serveWithCors } from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { handlePotPay } from './handler.ts';

serveWithCors((request) => handlePotPay(request, { asService, enforceRateLimit }));
