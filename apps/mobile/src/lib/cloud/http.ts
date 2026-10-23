/**
 * The HTTP shapes the providers need, in one place.
 *
 * A ledger backup is a string the app already holds in memory, not a file on
 * disk. Fetch handles metadata and reads; XHR supplies upload progress. (The
 * deleted image-backup version of this module used expo-file-system's native
 * uploader to avoid base64-ing megabytes of JPEG through the bridge; a few
 * hundred kilobytes of JSON does not earn that.)
 *
 * Non-2xx responses retain only their status: provider bodies may contain
 * private information and must never reach logs or crash reports.
 */

export class CloudHttpError extends Error {
  readonly code: 'quota' | 'rate-limit' | undefined;
  constructor(
    readonly status: number,
    _body: string,
  ) {
    super(`cloud request failed (${status})`);
    this.name = 'CloudHttpError';
    this.code = status === 429 ? 'rate-limit' : undefined;
    try {
      const parsed = JSON.parse(_body) as { error?: { errors?: { reason?: string }[] } };
      const reasons = parsed?.error?.errors?.map((item) => item.reason) ?? [];
      if (
        reasons.some((reason) =>
          ['storageQuotaExceeded', 'quotaExceeded', 'dailyLimitExceeded'].includes(reason ?? ''),
        )
      )
        this.code = 'quota';
      else if (
        reasons.some((reason) =>
          ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason ?? ''),
        )
      )
        this.code = 'rate-limit';
    } catch {
      /* Response text is deliberately discarded. */
    }
  }
}

/** True for the statuses that mean "these tokens are no longer any good". */
export function isAuthFailure(error: unknown): boolean {
  return (
    error instanceof CloudHttpError &&
    (error.status === 401 || (error.status === 403 && !error.code))
  );
}

/** A JSON request; returns the parsed body. */
export async function requestJson(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new CloudHttpError(response.status, text);
  return parse(text);
}

/**
 * A request whose body is raw text (an upload); returns the parsed response.
 *
 * The body is optional so the same helper covers a DELETE, which carries none
 * and answers 204 with nothing — `parse` reads an empty response as an empty
 * object rather than a failure.
 */
export async function requestRaw(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string },
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
  });
  const text = await response.text();
  if (!response.ok) throw new CloudHttpError(response.status, text);
  return parse(text);
}

/** A request whose *response* is the payload — the download side. */
export async function requestText(
  url: string,
  options: { headers: Record<string, string>; signal?: AbortSignal },
): Promise<string> {
  const response = await fetch(url, { headers: options.headers, signal: options.signal });
  const text = await response.text();
  if (!response.ok) throw new CloudHttpError(response.status, text);
  return text;
}

function parse(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

/** Native XHR supplies real uploaded-byte progress and abort support. */
export function uploadRaw(
  url: string,
  headers: Record<string, string>,
  body: string,
  control?: import('./types').UploadControl,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => control?.signal?.removeEventListener('abort', abort);
    xhr.open('POST', url);
    xhr.timeout = 120_000;
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) =>
      control?.onProgress?.(event.loaded, event.lengthComputable ? event.total : 0);
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) resolve(parse(xhr.responseText));
      else reject(new CloudHttpError(xhr.status, 'upload failed'));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new Error('Backup upload timed out'));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('Backup transport failed'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new Error('Backup cancelled'));
    };
    control?.signal?.addEventListener('abort', abort);
    if (control?.signal?.aborted) {
      cleanup();
      reject(new Error('Backup cancelled'));
      return;
    }
    xhr.send(body);
  });
}
