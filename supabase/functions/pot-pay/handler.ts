import { errorResponse, HttpError, json, type SupabaseClient } from '../_shared/auth.ts';
import { readBoundedText } from '../otp-send/handler.ts';

export interface PotPayDeps {
  asService(): SupabaseClient;
  enforceRateLimit(service: SupabaseClient, request: Request, bucket: 'pot-pay'): Promise<void>;
}

/** Public capability endpoint. Never return member, pot or settlement identifiers. */
export async function handlePotPay(request: Request, deps: PotPayDeps): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');
    const service = deps.asService();
    await deps.enforceRateLimit(service, request, 'pot-pay');
    const text = await readBoundedText(request, 2048);
    if (text === null) throw new HttpError(413, 'INVALID_INPUT', 'Request too large');
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'INVALID_INPUT', 'Invalid JSON');
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof body.code !== 'string' ||
      !/^[a-f0-9]{32}$/.test(body.code) ||
      !['lookup', 'report'].includes(body.action)
    ) {
      throw new HttpError(400, 'INVALID_INPUT', 'Invalid pay link request');
    }
    if (body.action === 'lookup') {
      const { data, error } = await service.rpc('pot_pay_lookup', { code: body.code });
      if (error) throw error;
      if (!data) return json(null);
      return json({
        potName: data.potName,
        groupName: data.groupName,
        perHeadMinor: data.perHeadMinor,
        currency: data.currency,
        payeeName: data.payeeName,
        payeeVpa: data.payeeVpa,
      });
    }
    const name = typeof body.payerName === 'string' ? body.payerName.trim() : '';
    const utr =
      body.utr == null
        ? null
        : typeof body.utr === 'string'
          ? body.utr.trim().toUpperCase()
          : undefined;
    if (
      !name ||
      name.length > 100 ||
      utr === undefined ||
      (utr && (utr.length > 64 || !/^([0-9]{12}|[A-Z]{4}[A-Z0-9][0-9]{9,})$/.test(utr)))
    ) {
      throw new HttpError(400, 'INVALID_INPUT', 'Invalid payment report');
    }
    const { data, error } = await service.rpc('pot_pay_self_report', {
      code: body.code,
      payer_name: name,
      utr: utr || null,
    });
    if (error) throw error;
    return json(data === true);
  } catch (error) {
    return errorResponse(error, { fn: 'pot-pay' });
  }
}
