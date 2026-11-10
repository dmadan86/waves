/**
 * ota — a self-hosted expo-updates server (protocol v0/v1), replacing EAS Update.
 *
 * This function holds no signing key and builds nothing. `scripts/ota-publish.mjs`
 * builds each manifest at publish time, signs its exact bytes, and uploads both;
 * this function only serves those stored bytes verbatim, so write access to the
 * bucket is not enough to get code signed.
 *
 * Layout in the OTA bucket (see docs/ota.md):
 *
 *   ota/<runtime>/<channel>/<platform>/latest.json                    { updateId }
 *   ota/<runtime>/<channel>/<platform>/<updateId>/manifest.json       the manifest, as signed
 *   ota/<runtime>/<channel>/<platform>/<updateId>/manifest.sig        base64 RSA-SHA256 of those bytes
 *   ota/<runtime>/<channel>/<platform>/directive.sig                  signature of the noUpdateAvailable directive
 *   ota/<runtime>/<folder>/...                                        the bundle and assets (served by OTA_ASSET_BASE_URL)
 *
 * `latest.json` is the only mutable object and is written last, so publishing
 * is one atomic switch. Spec: https://docs.expo.dev/technical-specs/expo-updates-1/
 */

import { errorResponse, HttpError } from '../_shared/auth.ts';

export interface OtaDeps {
  /** Text of the object at `key` in the OTA bucket, or null when absent. */
  getText: (key: string) => Promise<string | null>;
}

const SAFE = /^[A-Za-z0-9._+-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLATFORMS = new Set(['ios', 'android']);

/** The directive body the publisher signed; it must match byte for byte. */
export const NO_UPDATE_DIRECTIVE = '{"type":"noUpdateAvailable"}';

/** One multipart/mixed response carrying `text` verbatim as its single part. */
function multipart(
  protocolVersion: string,
  channel: string,
  name: 'manifest' | 'directive',
  text: string,
  signature: string | null,
): Response {
  const mark = `waves-ota-${crypto.randomUUID()}`;
  const headers = [
    `content-disposition: form-data; name="${name}"`,
    'content-type: application/json; charset=utf-8',
  ];
  if (signature) {
    headers.push(`expo-signature: sig="${signature}", keyid="main", alg="rsa-v1_5-sha256"`);
  }
  const payload = `--${mark}\r\n${headers.join('\r\n')}\r\n\r\n${text}\r\n--${mark}--\r\n`;
  return new Response(payload, {
    status: 200,
    headers: {
      'content-type': `multipart/mixed; boundary=${mark}`,
      'expo-protocol-version': protocolVersion,
      'expo-sfv-version': '0',
      'cache-control': 'private, max-age=0',
      'expo-manifest-filters': `expo-channel-name="${channel}"`,
      'expo-server-defined-headers': '',
    },
  });
}

export async function handleOta(request: Request, deps: OtaDeps): Promise<Response> {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'METHOD', 'GET only');

    const url = new URL(request.url);
    const header = (name: string, query: string) =>
      request.headers.get(name) ?? url.searchParams.get(query);

    // Stored responses are multipart/mixed only; say so rather than send a
    // format the client did not ask for.
    const accept = request.headers.get('accept');
    if (accept && !/multipart\/mixed|multipart\/\*|\*\/\*/.test(accept)) {
      throw new HttpError(406, 'NOT_ACCEPTABLE', 'Only multipart/mixed is served');
    }

    const protocolVersion = request.headers.get('expo-protocol-version') === '1' ? '1' : '0';
    const platform = header('expo-platform', 'platform') ?? '';
    const runtime = header('expo-runtime-version', 'runtime-version') ?? '';
    const channel = header('expo-channel-name', 'channel-name') ?? 'production';
    if (!PLATFORMS.has(platform)) throw new HttpError(400, 'BAD_PLATFORM', 'Unsupported platform');
    if (!SAFE.test(runtime)) throw new HttpError(400, 'BAD_RUNTIME', 'Bad runtime version');
    if (!SAFE.test(channel)) throw new HttpError(400, 'BAD_CHANNEL', 'Bad channel');
    const expectsSignature = request.headers.has('expo-expect-signature');

    const dir = `ota/${runtime}/${channel}/${platform}`;
    const empty = () =>
      new Response(null, { status: 204, headers: { 'cache-control': 'private, max-age=0' } });

    // Protocol 0 has no directives, so "nothing new" is an empty 204. So is a
    // directive nobody signed, when the client insists on a signature: it would
    // be rejected on the device anyway.
    const noUpdate = async () => {
      if (protocolVersion !== '1') return empty();
      const signature = expectsSignature ? await deps.getText(`${dir}/directive.sig`) : null;
      if (expectsSignature && !signature) return empty();
      return multipart(protocolVersion, channel, 'directive', NO_UPDATE_DIRECTIVE, signature);
    };

    const pointerText = await deps.getText(`${dir}/latest.json`);
    if (pointerText === null) return await noUpdate();
    const updateId = (JSON.parse(pointerText) as { updateId?: unknown }).updateId;
    if (typeof updateId !== 'string' || !UUID.test(updateId)) {
      throw new HttpError(500, 'BAD_POINTER', 'latest.json is malformed');
    }
    if (request.headers.get('expo-current-update-id')?.toLowerCase() === updateId) {
      return await noUpdate();
    }

    const [manifest, signature] = await Promise.all([
      deps.getText(`${dir}/${updateId}/manifest.json`),
      expectsSignature ? deps.getText(`${dir}/${updateId}/manifest.sig`) : Promise.resolve(null),
    ]);
    if (manifest === null || (expectsSignature && !signature)) {
      throw new HttpError(500, 'BAD_UPDATE', 'Update files are missing');
    }
    return multipart(protocolVersion, channel, 'manifest', manifest, signature?.trim() ?? null);
  } catch (error) {
    return errorResponse(error, { fn: 'ota' });
  }
}
