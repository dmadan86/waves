/** Unverified app callback data. Even SUCCESS is never proof of payment. */
export interface UpiResponse {
  txnId?: string;
  responseCode?: string;
  Status?: string;
  txnRef?: string;
  ApprovalRefNo?: string;
}

const keys = ['txnId', 'responseCode', 'Status', 'txnRef', 'ApprovalRefNo'] as const;

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** Parse only documented fields, retaining their values without interpreting status. */
export function parseUpiResponse(raw: string | null | undefined): UpiResponse | null {
  if (!raw) return null;
  const result: UpiResponse = {};
  for (const part of raw.split('&')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = decode(part.slice(0, separator));
    const key = keys.find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (key) result[key] = decode(part.slice(separator + 1));
  }
  return Object.keys(result).length ? result : null;
}
