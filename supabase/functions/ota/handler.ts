/**
 * ota — a self-hosted expo-updates server (protocol v0/v1), replacing EAS Update.
 *
 * Storage layout in the OTA bucket (written by `scripts/ota-publish.mjs`):
 *
 *   ota/<runtime>/<channel>/<platform>/latest.json   { updateId, folder, createdAt }
 *   ota/<runtime>/<folder>/metadata.json             `expo export` metadata + { hashes }
 *   ota/<runtime>/<folder>/expoConfig.json           the public Expo config
 *   ota/<runtime>/<folder>/<bundle or assets/...>    the files themselves
 *
 * `latest.json` is the only mutable object, so publishing is one atomic write.
 * `updateId` is the id the device sees (fresh on every publish and rollback, so
 * a rollback is a *newer* update to the client); `folder` is where the files
 * live. Spec: https://docs.expo.dev/technical-specs/expo-updates-1/
 */

import { errorResponse, HttpError } from '../_shared/auth.ts';
import { signBody } from './sign.ts';

export interface OtaDeps {
  /** Parsed JSON object at `key` in the OTA bucket, or null when absent. */
  getJson: (key: string) => Promise<unknown>;
  /** A URL the device can GET the object at `key` from. */
  assetUrl: (key: string) => Promise<string>;
  /** PEM private key; enables signing for clients that send `expo-expect-signature`. */
  privateKey?: string;
}

interface Pointer {
  updateId: string;
  folder: string;
  createdAt: string;
}

interface PlatformFiles {
  bundle: string;
  assets: { path: string; ext: string }[];
}

interface Metadata {
  fileMetadata: Record<string, PlatformFiles>;
  hashes: Record<string, string>;
}

const SAFE = /^[A-Za-z0-9._+-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLATFORMS = new Set(['ios', 'android']);

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  json: 'application/json',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  txt: 'text/plain',
  html: 'text/html',
  js: 'application/javascript',
};

function boundary(): string {
  return `waves-ota-${crypto.randomUUID()}`;
}

/** One multipart/mixed response; every part is signed when `sign` is given. */
async function multipart(
  protocolVersion: string,
  channel: string,
  name: 'manifest' | 'directive',
  body: unknown,
  sign: ((text: string) => Promise<string>) | null,
): Promise<Response> {
  const text = JSON.stringify(body);
  const mark = boundary();
  const headers = [
    `content-disposition: form-data; name="${name}"`,
    'content-type: application/json; charset=utf-8',
  ];
  if (sign) {
    headers.push(`expo-signature: sig="${await sign(text)}", keyid="main", alg="rsa-v1_5-sha256"`);
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

function pointerFrom(value: unknown): Pointer {
  const p = value as Partial<Pointer> | null;
  if (
    !p ||
    typeof p.updateId !== 'string' ||
    !UUID.test(p.updateId) ||
    typeof p.folder !== 'string' ||
    !SAFE.test(p.folder) ||
    typeof p.createdAt !== 'string' ||
    Number.isNaN(Date.parse(p.createdAt))
  ) {
    throw new HttpError(500, 'BAD_POINTER', 'latest.json is malformed');
  }
  return p as Pointer;
}

export async function handleOta(request: Request, deps: OtaDeps): Promise<Response> {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'METHOD', 'GET only');

    const url = new URL(request.url);
    const header = (name: string, query: string) =>
      request.headers.get(name) ?? url.searchParams.get(query);

    const protocolVersion = request.headers.get('expo-protocol-version') === '1' ? '1' : '0';
    const platform = header('expo-platform', 'platform') ?? '';
    const runtime = header('expo-runtime-version', 'runtime-version') ?? '';
    const channel = header('expo-channel-name', 'channel-name') ?? 'production';
    if (!PLATFORMS.has(platform)) throw new HttpError(400, 'BAD_PLATFORM', 'Unsupported platform');
    if (!SAFE.test(runtime)) throw new HttpError(400, 'BAD_RUNTIME', 'Bad runtime version');
    if (!SAFE.test(channel)) throw new HttpError(400, 'BAD_CHANNEL', 'Bad channel');

    const expectsSignature = request.headers.has('expo-expect-signature');
    if (expectsSignature && !deps.privateKey) {
      // The app is built to refuse unsigned updates; answering unsigned would
      // only fail on the device with no explanation.
      throw new HttpError(
        500,
        'MISCONFIGURED',
        'Client expects a signature; OTA_PRIVATE_KEY unset',
      );
    }
    const key = deps.privateKey;
    const sign = expectsSignature && key ? (text: string) => signBody(key, text) : null;

    // Protocol 0 has no directives, so "nothing new" is an empty 204.
    const noUpdate = () =>
      protocolVersion === '1'
        ? multipart(protocolVersion, channel, 'directive', { type: 'noUpdateAvailable' }, sign)
        : Promise.resolve(
            new Response(null, { status: 204, headers: { 'cache-control': 'private, max-age=0' } }),
          );

    const root = `ota/${runtime}`;
    const raw = await deps.getJson(`${root}/${channel}/${platform}/latest.json`);
    if (raw === null || raw === undefined) return await noUpdate();
    const pointer = pointerFrom(raw);
    if (request.headers.get('expo-current-update-id')?.toLowerCase() === pointer.updateId) {
      return await noUpdate();
    }

    const folder = `${root}/${pointer.folder}`;
    const [metadata, expoConfig] = await Promise.all([
      deps.getJson(`${folder}/metadata.json`) as Promise<Metadata | null>,
      deps.getJson(`${folder}/expoConfig.json`),
    ]);
    const files = metadata?.fileMetadata?.[platform];
    if (!metadata || !files?.bundle) {
      throw new HttpError(500, 'BAD_UPDATE', 'Update files are missing');
    }

    const asset = async (path: string, contentType: string, ext?: string) => {
      const hash = metadata.hashes?.[path];
      if (!hash) throw new HttpError(500, 'BAD_UPDATE', 'Update is missing a hash');
      return {
        hash,
        key: path.split('/').pop() ?? path,
        contentType,
        ...(ext ? { fileExtension: `.${ext}` } : {}),
        url: await deps.assetUrl(`${folder}/${path}`),
      };
    };

    const manifest = {
      id: pointer.updateId,
      createdAt: pointer.createdAt,
      runtimeVersion: runtime,
      launchAsset: await asset(files.bundle, 'application/javascript'),
      assets: await Promise.all(
        files.assets.map((a) =>
          asset(a.path, CONTENT_TYPES[a.ext] ?? 'application/octet-stream', a.ext),
        ),
      ),
      metadata: { 'expo-channel-name': channel },
      extra: { expoClient: expoConfig ?? {} },
    };
    return await multipart(protocolVersion, channel, 'manifest', manifest, sign);
  } catch (error) {
    return errorResponse(error, { fn: 'ota' });
  }
}
