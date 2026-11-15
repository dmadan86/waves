#!/usr/bin/env node
/**
 * OTA code-signing keys, with node:crypto only.
 *
 *   node scripts/ota-keys.mjs generate [--key ~/.waves-keys/updates/private-key.pem]
 *                                      [--cert certs/certificate.pem]
 *   node scripts/ota-keys.mjs check    [same flags]   # does the key match the cert?
 *
 * The certificate (public) is committed and baked into the store build via
 * `updates.codeSigningCertificate`; the private key NEVER is — it goes in the
 * OTA_PRIVATE_KEY secret of the `ota` edge function. Node cannot build an X.509
 * certificate, so the minimal DER one expo-updates accepts (self-signed, RSA
 * 2048, key usage digitalSignature + extended key usage codeSigning, both
 * critical, 10 years) is assembled by hand below.
 *
 * Replacing a certificate that is already in a released build strands every
 * installed copy: they would reject updates signed by the new key. `generate`
 * refuses to overwrite either file.
 */

import {
  X509Certificate,
  createPrivateKey,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    key: { type: 'string', default: join(homedir(), '.waves-keys/updates/private-key.pem') },
    cert: { type: 'string', default: 'certs/certificate.pem' },
  },
});

const der = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  const n = body.length;
  const len = n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return Buffer.concat([Buffer.from([tag, ...len]), body]);
};
const oid = (...bytes) => der(0x06, Buffer.from(bytes));
const SHA256_RSA = der(0x30, oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b), der(0x05));
const name = der(
  0x30,
  der(0x31, der(0x30, oid(0x55, 0x04, 0x03), der(0x13, Buffer.from('Waves')))),
);
const utc = (date) =>
  der(
    0x17,
    Buffer.from(
      date
        .toISOString()
        .replace(/[-:T]|\.\d{3}/g, '')
        .slice(2),
    ),
  );
const extension = (id, value) => der(0x30, id, der(0x01, Buffer.from([0xff])), der(0x04, value));

function selfSignedCertificate(privateKey, publicKey) {
  const now = new Date();
  const end = new Date(now);
  end.setUTCFullYear(end.getUTCFullYear() + 10);
  const serial = randomBytes(9);
  serial[0] &= 0x7f;
  serial[0] |= 0x01; // positive, no leading zero byte to normalise
  const tbs = der(
    0x30,
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    SHA256_RSA,
    name,
    der(0x30, utc(now), utc(end)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    der(
      0xa3,
      der(
        0x30,
        extension(oid(0x55, 0x1d, 0x0f), der(0x03, Buffer.from([0x07, 0x80]))), // digitalSignature
        extension(
          oid(0x55, 0x1d, 0x25),
          der(0x30, oid(0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x03)), // codeSigning
        ),
      ),
    ),
  );
  const signature = createSign('RSA-SHA256').update(tbs).sign(privateKey);
  return der(0x30, tbs, SHA256_RSA, der(0x03, Buffer.from([0]), signature));
}

const command = positionals[0];
if (command === 'generate') {
  for (const file of [args.key, args.cert]) {
    if (existsSync(file)) {
      console.error(`refusing to overwrite ${file}`);
      process.exit(1);
    }
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const certificate = selfSignedCertificate(privateKey, publicKey);
  const pem = `-----BEGIN CERTIFICATE-----\n${certificate
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n')}\n-----END CERTIFICATE-----\n`;
  mkdirSync(dirname(args.key), { recursive: true });
  mkdirSync(dirname(args.cert), { recursive: true });
  writeFileSync(args.key, privateKey.export({ type: 'pkcs1', format: 'pem' }), { mode: 0o600 });
  chmodSync(args.key, 0o600);
  writeFileSync(args.cert, pem);
  console.log(`private key: ${args.key}   (set it as OTA_PRIVATE_KEY; never commit it)`);
  console.log(`certificate: ${args.cert}   (commit it; ship a new store build)`);
} else if (command === 'check') {
  const certificate = new X509Certificate(readFileSync(args.cert));
  const ok = certificate.checkPrivateKey(createPrivateKey(readFileSync(args.key)));
  console.log(ok ? 'key matches certificate' : 'KEY DOES NOT MATCH CERTIFICATE');
  process.exit(ok ? 0 : 1);
} else {
  console.error('usage: ota-keys.mjs generate|check [--key path] [--cert path]');
  process.exit(1);
}
