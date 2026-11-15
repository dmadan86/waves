export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const LOGO_TIMEOUT_MS = 10000;
export const MAX_LOGO_REDIRECTS = 3;

export type LogoLinkError =
  | 'empty'
  | 'invalid'
  | 'not_https'
  | 'blocked_host'
  | 'timeout'
  | 'network'
  | 'http'
  | 'not_image'
  | 'svg'
  | 'too_large'
  | 'too_many_redirects';
type Failure = { ok: false; error: LogoLinkError };
type Mime = 'image/png' | 'image/jpeg' | 'image/webp';
const fail = (error: LogoLinkError): Failure => ({ ok: false, error });

export function parseLogoUrl(input: string): { ok: true; url: string } | Failure {
  const value = input.trim();
  if (!value) return fail('empty');
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return fail('invalid');
  }
  if (url.protocol !== 'https:') return fail('not_https');
  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');
  const parts = host.split('.').map(Number);
  const ipv4 = parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  // URL canonicalizes unusual IPv4 spellings and IPv6 compression before this check.
  const privateV4 =
    ipv4 &&
    (parts[0] === 127 ||
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      host === '0.0.0.0');
  // Any IPv6 literal: mapped forms (::ffff:7f00:1) hide loopback, and no real logo lives on one.
  const privateV6 = host.includes(':');
  if (
    url.username ||
    url.password ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    privateV4 ||
    privateV6
  )
    return fail('blocked_host');
  return { ok: true, url: url.href };
}

export function checkLogoHeaders({
  status,
  contentType,
  contentLength,
}: {
  status: number;
  contentType?: string | null;
  contentLength?: number | string | null;
}): LogoLinkError | null {
  if (status < 200 || status >= 300) return 'http';
  const mime = contentType?.split(';')[0]?.trim().toLowerCase();
  if (mime === 'image/svg+xml') return 'svg';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime ?? '')) return 'not_image';
  if (contentLength != null && Number(contentLength) > MAX_LOGO_BYTES) return 'too_large';
  return null;
}

export function sniffImage(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (
    bytes.length >= 12 &&
    [82, 73, 70, 70].every((b, i) => bytes[i] === b) &&
    [87, 69, 66, 80].every((b, i) => bytes[i + 8] === b)
  )
    return 'webp';
  return null;
}

export async function downloadLogo(
  url: string,
  deps: {
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
    now?: () => number;
  } = {},
): Promise<{ ok: true; bytes: Uint8Array; mime: Mime } | Failure> {
  const parsed = parseLogoUrl(url);
  if (!parsed.ok) return parsed;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGO_TIMEOUT_MS);
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    let current = parsed.url;
    let hops = 0;
    for (;;) {
      const response = await fetchImpl(current, {
        redirect: 'manual',
        credentials: 'omit',
        headers: { Accept: 'image/png,image/jpeg,image/webp' },
        signal: controller.signal,
      });
      const location = response.headers.get('location');
      // A runtime that hides the redirect target cannot be validated per hop: refuse, never follow blind.
      if (response.type === 'opaqueredirect' || (response.status === 0 && !location)) {
        return fail('network');
      }
      if (response.url) {
        const final = parseLogoUrl(response.url);
        if (!final.ok) return final;
      }
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        if (++hops > MAX_LOGO_REDIRECTS) return fail('too_many_redirects');
        let next: string;
        try {
          next = new URL(location, current).href;
        } catch {
          return fail('invalid');
        }
        const target = parseLogoUrl(next);
        if (!target.ok) return target;
        current = target.url;
        continue;
      }
      const error = checkLogoHeaders({
        status: response.status,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
      });
      if (error) return fail(error);
      let bytes: Uint8Array;
      const reader = response.body?.getReader?.();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_LOGO_BYTES) {
              controller.abort();
              return fail('too_large');
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
      } else {
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      if (controller.signal.aborted) return fail('timeout');
      if (bytes.byteLength > MAX_LOGO_BYTES) return fail('too_large');
      const format = sniffImage(bytes);
      const mime = `image/${format}` as Mime;
      if (
        !format ||
        mime !== response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
      )
        return fail('not_image');
      return { ok: true, bytes, mime };
    }
  } catch (error) {
    return fail(
      controller.signal.aborted || (error as { name?: string })?.name === 'AbortError'
        ? 'timeout'
        : 'network',
    );
  } finally {
    clearTimeout(timer);
  }
}
