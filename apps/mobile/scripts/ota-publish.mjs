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
 *   ota/<runtime>/<folder>/...                                     immutable files + metadata.json + expoConfig.json
 *   ota/<runtime>/<channel>/<platform>/<updateId>/manifest.json    the manifest, built and SIGNED here
 *   ota/<runtime>/<channel>/<platform>/<updateId>/manifest.sig
 *   ota/<runtime>/<channel>/<platform>/directive.sig
 *   ota/<runtime>/<channel>/<platform>/latest.json                 the pointer, written LAST (the atomic switch)
 *
 * Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, OTA_R2_BUCKET,
 *      OTA_ASSET_BASE_URL (public https URL of the bucket), OTA_PRIVATE_KEY (PEM).
 *      The signing key exists only where this script runs, never in the edge function.
 * No dependencies: requests are signed with AWS SigV4 by hand.
 */

import {
  X509Certificate,
  createHash,
  createHmac,
  createSign,
  createVerify,
  randomUUID,
} from 'node:crypto';
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

// ──────────────────────────────────────────────────────── manifest + signing ──

const CONTENT_TYPES = {
  js: 'application/javascript',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
};

// Both are publisher-side only: the edge function holds no key and builds no
// manifest, so bucket write access alone cannot get code signed.
const privateKey = (process.env.OTA_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
const assetBase = (process.env.OTA_ASSET_BASE_URL ?? '').replace(/\/+$/, '');
if (!dryRun) {
  if (!privateKey.includes('PRIVATE KEY')) fail('OTA_PRIVATE_KEY is not set (PEM)');
  if (!/^https:\/\//.test(assetBase))
    fail('OTA_ASSET_BASE_URL must be the https URL of the bucket');
}
const sign = (text) =>
  privateKey ? createSign('RSA-SHA256').update(text).sign(privateKey, 'base64') : 'DRY-RUN';

const NO_UPDATE_DIRECTIVE = '{"type":"noUpdateAvailable"}'; // must match the handler
const dirOf = (platform) => `ota/${runtimes[platform]}/${args.channel}/${platform}`;
const assetUrl = (platform, folder, path) =>
  `${assetBase || 'https://assets.example'}/${`ota/${runtimes[platform]}/${folder}/${path}`
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

/** The exact manifest text devices will receive; the signature covers these bytes. */
function manifestText({ platform, folder, files, hashes, updateId, createdAt }) {
  const asset = (path, contentType, ext) => {
    if (!hashes[path]) fail(`no hash for ${path}`);
    return {
      hash: hashes[path],
      key: path.split('/').pop(),
      contentType,
      ...(ext ? { fileExtension: `.${ext}` } : {}),
      url: assetUrl(platform, folder, path),
    };
  };
  return JSON.stringify({
    id: updateId,
    createdAt,
    runtimeVersion: runtimes[platform],
    launchAsset: asset(files.bundle, 'application/javascript'),
    assets: files.assets.map((a) =>
      asset(a.path, CONTENT_TYPES[a.ext] ?? 'application/octet-stream', a.ext),
    ),
    metadata: { 'expo-channel-name': args.channel },
    extra: { expoClient: config },
  });
}

/** Sign + upload one platform's manifest; returns the pointer write to do LAST. */
async function stageManifest(input) {
  const { platform, updateId } = input;
  const text = manifestText(input);
  const dir = dirOf(platform);
  if (dryRun) {
    console.log(`  PUT ${dir}/${updateId}/manifest.json + manifest.sig (signed here)`);
    console.log(`  PUT ${dir}/directive.sig`);
  } else {
    const immutable = 'public, max-age=31536000, immutable';
    await put(`${dir}/${updateId}/manifest.json`, Buffer.from(text), 'application/json', immutable);
    await put(`${dir}/${updateId}/manifest.sig`, Buffer.from(sign(text)), 'text/plain', immutable);
    await put(
      `${dir}/directive.sig`,
      Buffer.from(sign(NO_UPDATE_DIRECTIVE)),
      'text/plain',
      'no-store',
    );
  }
  return async () => {
    const pointer = {
      updateId,
      folder: input.folder,
      createdAt: input.createdAt,
      message: args.message,
    };
    if (dryRun) return console.log(`  PUT ${dir}/latest.json  (last)`);
    await put(
      `${dir}/latest.json`,
      Buffer.from(JSON.stringify(pointer)),
      'application/json',
      'no-store',
    );
  };
}

// ───────────────────────────────────────────────────────────── rollback ──

if (args.rollback) {
  const folder = args.rollback;
  if (!/^[A-Za-z0-9._+-]{1,128}$/.test(folder)) fail(`bad folder id ${folder}`);
  if (dryRun) {
    for (const p of platforms) console.log(`[dry-run] ${dirOf(p)}/latest.json -> ${folder}`);
    process.exit(0);
  }
  // Check every target platform before moving any pointer.
  const staged = [];
  for (const p of platforms) {
    const found = await request('GET', `ota/${runtimes[p]}/${folder}/metadata.json`);
    if (!found.ok)
      fail(`no published update ${folder} for runtime ${runtimes[p]} (${found.status})`);
    // metadata.json is only trusted if we signed it at publish time: a rollback
    // must not sign hashes someone with bucket write access slipped in.
    const metadataText = await found.text();
    const sigResponse = await request('GET', `ota/${runtimes[p]}/${folder}/metadata.sig`);
    const certificate = new X509Certificate(readFileSync('certs/certificate.pem'));
    if (
      !sigResponse.ok ||
      !createVerify('RSA-SHA256')
        .update(metadataText)
        .verify(certificate.publicKey, (await sigResponse.text()).trim(), 'base64')
    ) {
      fail(`update ${folder} has no valid signature for ${p}; cannot roll back to it`);
    }
    const published = JSON.parse(metadataText);
    const files = published.fileMetadata?.[p];
    const wanted = files ? [files.bundle, ...files.assets.map((a) => a.path)] : [];
    if (!files?.bundle || !wanted.every((path) => published.hashes?.[path])) {
      fail(`update ${folder} was not published for ${p}`);
    }
    // Same files, new update id and date: to a device it is a newer update.
    staged.push(
      await stageManifest({
        platform: p,
        folder,
        files,
        hashes: published.hashes,
        updateId: randomUUID(),
        createdAt: new Date().toISOString(),
      }),
    );
  }
  for (const writePointer of staged) await writePointer();
  console.log(`rolled back to ${folder}`);
  process.exit(0);
}

// ───────────────────────────────────────────────────────────── publish ──

const metadataPath = join(args.dist, 'metadata.json');
if (!existsSync(metadataPath)) fail(`${metadataPath} not found — run \`npx expo export\` first`);
const metadataRaw = readFileSync(metadataPath);
const metadata = JSON.parse(metadataRaw);
const configRaw = Buffer.from(JSON.stringify(config));

// The folder id is the content hash shaped as a UUID, so re-publishing the same
// build reuses its files; the id a device sees is minted fresh per publish.
// The platform selection is part of it: a folder holds hashes for only the
// platforms published into it.
const digest = createHash('sha256')
  .update(metadataRaw)
  .update(configRaw)
  .update(platforms.join())
  .digest();
digest[6] = (digest[6] & 0x0f) | 0x40;
digest[8] = (digest[8] & 0x3f) | 0x80;
const folder = [0, 4, 6, 8, 10]
  .map((start, i, a) => digest.subarray(start, a[i + 1] ?? 16).toString('hex'))
  .join('-');

const uploads = new Map(); // key -> { body, contentType }
const hashes = {}; // per runtime: path -> base64url sha256
for (const platform of platforms) {
  const files = metadata.fileMetadata?.[platform];
  if (!files?.bundle) fail(`${metadataPath} has no ${platform} bundle`);
  const root = `ota/${runtimes[platform]}/${folder}`;
  const bag = (hashes[runtimes[platform]] ??= {});
  // Exported assets have extensionless paths; the declared `ext` names the type.
  const typed = [
    { path: files.bundle, ext: 'js' },
    ...files.assets.map((a) => ({ path: a.path, ext: a.ext })),
  ];
  for (const { path, ext } of typed) {
    const file = join(args.dist, path);
    if (!existsSync(file)) fail(`missing exported file ${file}`);
    const body = readFileSync(file);
    bag[path] = createHash('sha256').update(body).digest('base64url');
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
  // Lets a later rollback prove these hashes are ours (see --rollback).
  uploads.set(`${root}/metadata.sig`, {
    body: Buffer.from(sign(augmented.toString())),
    contentType: 'text/plain',
  });
  uploads.set(`${root}/expoConfig.json`, { body: configRaw, contentType: 'application/json' });
}

console.log(
  `${dryRun ? '[dry-run] ' : ''}folder ${folder}  channel ${args.channel}  ` +
    platforms.map((p) => `${p}@${runtimes[p]}`).join(' ') +
    `  ${uploads.size} objects`,
);
if (dryRun) for (const key of uploads.keys()) console.log(`  PUT ${key}`);

// Order: immutable files, then signed manifests, then the pointers last: a
// device never sees a pointer whose manifest, signature or files are missing.
if (!dryRun) {
  const entries = [...uploads.entries()];
  for (let i = 0; i < entries.length; i += 8) {
    await Promise.all(
      entries
        .slice(i, i + 8)
        .map(([key, { body, contentType }]) =>
          put(key, body, contentType, 'public, max-age=31536000, immutable'),
        ),
    );
  }
}
const pointers = [];
for (const platform of platforms) {
  pointers.push(
    await stageManifest({
      platform,
      folder,
      files: metadata.fileMetadata[platform],
      hashes: hashes[runtimes[platform]],
      updateId: randomUUID(),
      createdAt,
    }),
  );
}
for (const writePointer of pointers) await writePointer();
if (!dryRun)
  console.log(`published ${folder} — roll back to a previous one with --rollback <folder>`);
