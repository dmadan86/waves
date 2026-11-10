#!/usr/bin/env node
/**
 * Publish an over-the-air update to R2 for the self-hosted `ota` edge function.
 *
 *   npx expo export --platform android --platform ios --output-dir dist
 *   node scripts/ota-publish.mjs [--platform all|android|ios] [--channel production]
 *                                [--message "..."] [--dry-run]
 *   node scripts/ota-publish.mjs --rollback <folderId> [--platform ..] [--channel ..]
 *
 * Layout written (read by supabase/functions/ota/handler.ts, see docs/ota.md):
 *   ota/<runtime>/<folder>/...                        immutable files + metadata.json + expoConfig.json
 *   ota/<runtime>/<channel>/<platform>/latest.json    the pointer, written LAST (the atomic switch)
 *
 * Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, OTA_R2_BUCKET.
 * No dependencies: requests are signed with AWS SigV4 by hand.
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    platform: { type: 'string', default: 'all' },
    channel: { type: 'string', default: process.env.OTA_CHANNEL || 'production' },
    dist: { type: 'string', default: 'dist' },
    message: { type: 'string', default: '' },
    rollback: { type: 'string' },
    prepare: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});
const dryRun = args['dry-run'];
const platforms = args.platform === 'all' ? ['android', 'ios'] : [args.platform];
if (!platforms.every((p) => p === 'android' || p === 'ios'))
  fail(`bad --platform ${args.platform}`);
if (!/^[A-Za-z0-9._-]{1,64}$/.test(args.channel)) fail(`bad --channel ${args.channel}`);

function fail(message) {
  console.error(`ota-publish: ${message}`);
  process.exit(1);
}

// ───────────────────────────────────────────────────────────── R2 (SigV4) ──

const hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

function r2() {
  const need = (name) => process.env[name] || fail(`${name} is not set`);
  const account = need('R2_ACCOUNT_ID');
  return {
    host: `${account}.r2.cloudflarestorage.com`,
    bucket: need('OTA_R2_BUCKET'),
    accessKey: need('R2_ACCESS_KEY_ID'),
    secretKey: need('R2_SECRET_ACCESS_KEY'),
  };
}

async function request(method, key, body = Buffer.alloc(0), headers = {}) {
  const { host, bucket, accessKey, secretKey } = r2();
  const path = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const signed = {
    ...headers,
    host,
    'x-amz-content-sha256': hex(body),
    'x-amz-date': stamp,
  };
  const names = Object.keys(signed).sort();
  const canonical = [
    method,
    path,
    '',
    names.map((n) => `${n}:${String(signed[n]).trim()}\n`).join(''),
    names.join(';'),
    signed['x-amz-content-sha256'],
  ].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, hex(canonical)].join('\n');
  const signingKey = ['auto', 's3', 'aws4_request'].reduce(
    (k, part) => hmac(k, part),
    hmac(`AWS4${secretKey}`, day),
  );
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${createHmac('sha256', signingKey).update(toSign).digest('hex')}`;
  const { host: _host, ...sendable } = signed;
  return fetch(`https://${host}${path}`, {
    method,
    headers: { ...sendable, authorization },
    body: method === 'PUT' ? body : undefined,
  });
}

async function put(key, body, contentType, cacheControl) {
  const response = await request('PUT', key, body, {
    'content-type': contentType,
    'cache-control': cacheControl,
  });
  if (!response.ok) fail(`PUT ${key} -> ${response.status} ${await response.text()}`);
}

// ─────────────────────────────────────────────────────── runtime version ──

// `--prepare` (CI build job, no secrets) resolves config + runtime versions into
// <dist>/ota-inputs.json; the publish job then needs no node_modules at all.
const inputsPath = join(args.dist, 'ota-inputs.json');
let config;
let runtimes;
if (!args.prepare && existsSync(inputsPath)) {
  ({ config, runtimes } = JSON.parse(readFileSync(inputsPath, 'utf8')));
} else {
  config = JSON.parse(
    execFileSync('npx', ['expo', 'config', '--json', '--type', 'public'], {
      encoding: 'utf8',
      env: { ...process.env, OTA_CHANNEL: args.channel },
      stdio: ['ignore', 'pipe', 'inherit'],
    }),
  );

  /** The same runtime version the installed app computes from app.json. */
  const runtimeFor = (platform) => {
    const rv = config.runtimeVersion;
    if (typeof rv === 'string') return rv;
    if (rv?.policy === 'appVersion') return config.version;
    if (rv?.policy === 'fingerprint') {
      const out = execFileSync(
        'npx',
        ['expo-updates', 'fingerprint:generate', '--platform', platform],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
      );
      return JSON.parse(out.slice(out.indexOf('{'))).hash;
    }
    return fail(`unsupported runtimeVersion ${JSON.stringify(rv)}`);
  };
  runtimes = Object.fromEntries(platforms.map((p) => [p, runtimeFor(p)]));
}
for (const p of platforms) {
  if (!/^[A-Za-z0-9._+-]{1,128}$/.test(runtimes[p] ?? ''))
    fail(`bad runtime version for ${p}: ${runtimes[p]}`);
}
if (args.prepare) {
  writeFileSync(inputsPath, JSON.stringify({ config, runtimes }));
  console.log(`wrote ${inputsPath}`);
  process.exit(0);
}

const pointerKey = (platform) =>
  `ota/${runtimes[platform]}/${args.channel}/${platform}/latest.json`;
const pointerBody = (folder) =>
  Buffer.from(
    JSON.stringify({
      updateId: randomUUID(),
      folder,
      createdAt: new Date().toISOString(),
      message: args.message,
    }),
  );
const putPointer = (platform, folder) =>
  put(pointerKey(platform), pointerBody(folder), 'application/json', 'no-store');

// ───────────────────────────────────────────────────────────── rollback ──

if (args.rollback) {
  const folder = args.rollback;
  if (!/^[A-Za-z0-9._+-]{1,128}$/.test(folder)) fail(`bad folder id ${folder}`);
  for (const p of platforms) {
    console.log(`${dryRun ? '[dry-run] ' : ''}${pointerKey(p)} -> ${folder}`);
    if (dryRun) continue;
    const found = await request('HEAD', `ota/${runtimes[p]}/${folder}/metadata.json`);
    if (!found.ok)
      fail(`no published update ${folder} for runtime ${runtimes[p]} (${found.status})`);
    await putPointer(p, folder);
  }
  process.exit(0);
}

// ───────────────────────────────────────────────────────────── publish ──

const metadataPath = join(args.dist, 'metadata.json');
if (!existsSync(metadataPath)) fail(`${metadataPath} not found — run \`npx expo export\` first`);
const metadataRaw = readFileSync(metadataPath);
const metadata = JSON.parse(metadataRaw);
const configRaw = Buffer.from(JSON.stringify(config));

// The folder id is the content hash shaped as a UUID, so re-publishing the same
// build reuses its files; the id a device sees is minted fresh in the pointer.
const digest = createHash('sha256').update(metadataRaw).update(configRaw).digest();
digest[6] = (digest[6] & 0x0f) | 0x40;
digest[8] = (digest[8] & 0x3f) | 0x80;
const folder = [0, 4, 6, 8, 10]
  .map((start, i, a) => digest.subarray(start, a[i + 1] ?? 16).toString('hex'))
  .join('-');

const CONTENT_TYPES = { json: 'application/json', js: 'application/javascript' };
const uploads = new Map(); // key -> { body, contentType }
const hashes = {}; // per runtime: path -> base64url sha256
for (const platform of platforms) {
  const files = metadata.fileMetadata?.[platform];
  if (!files?.bundle) fail(`${metadataPath} has no ${platform} bundle`);
  const root = `ota/${runtimes[platform]}/${folder}`;
  const bag = (hashes[runtimes[platform]] ??= {});
  for (const path of [files.bundle, ...files.assets.map((a) => a.path)]) {
    const file = join(args.dist, path);
    if (!existsSync(file)) fail(`missing exported file ${file}`);
    const body = readFileSync(file);
    bag[path] = createHash('sha256').update(body).digest('base64url');
    const ext = path.split('.').pop();
    uploads.set(`${root}/${path}`, {
      body,
      contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
    });
  }
}
const createdAt = new Date().toISOString();
for (const rt of new Set(Object.values(runtimes))) {
  const root = `ota/${rt}/${folder}`;
  const augmented = Buffer.from(JSON.stringify({ ...metadata, hashes: hashes[rt], createdAt }));
  uploads.set(`${root}/metadata.json`, { body: augmented, contentType: 'application/json' });
  uploads.set(`${root}/expoConfig.json`, { body: configRaw, contentType: 'application/json' });
}

console.log(
  `${dryRun ? '[dry-run] ' : ''}folder ${folder}  channel ${args.channel}  ` +
    platforms.map((p) => `${p}@${runtimes[p]}`).join(' ') +
    `  ${uploads.size} objects`,
);
if (dryRun) {
  for (const key of uploads.keys()) console.log(`  PUT ${key}`);
  for (const p of platforms) console.log(`  PUT ${pointerKey(p)}  (last)`);
  process.exit(0);
}

// Immutable files first (metadata.json last among them), the pointer after
// everything: a device never sees a pointer whose files are not there yet.
const entries = [...uploads.entries()].sort(
  ([a], [b]) => +a.endsWith('/metadata.json') - +b.endsWith('/metadata.json'),
);
for (let i = 0; i < entries.length; i += 8) {
  await Promise.all(
    entries
      .slice(i, i + 8)
      .map(([key, { body, contentType }]) =>
        put(key, body, contentType, 'public, max-age=31536000, immutable'),
      ),
  );
}
for (const p of platforms) await putPointer(p, folder);
console.log(`published ${folder} — roll back to a previous one with --rollback <folder>`);
