/**
 * Code signing for the OTA manifest: RSA-SHA256 (PKCS#1 v1.5) over the exact
 * bytes of the part being signed, the `rsa-v1_5-sha256` algorithm expo-updates
 * checks against the certificate in the app (`updates.codeSigningCertificate`).
 *
 * `OTA_PRIVATE_KEY` is a PEM. `openssl genrsa` and the key generated before this
 * existed are PKCS#1 (`BEGIN RSA PRIVATE KEY`); WebCrypto only imports PKCS#8,
 * so a PKCS#1 key is wrapped in the fixed PKCS#8 envelope first.
 */

const RSA_ALGORITHM_IDENTIFIER = [
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
];

function der(tag: number, content: Uint8Array): Uint8Array {
  const length = content.length;
  const header =
    length < 128
      ? [tag, length]
      : length < 256
        ? [tag, 0x81, length]
        : [tag, 0x82, length >> 8, length & 0xff];
  return Uint8Array.from([...header, ...content]);
}

function pemToPkcs8(pem: string): Uint8Array {
  // A multi-line PEM pasted into a one-line secret field arrives with literal \n.
  const text = pem.replace(/\\n/g, '\n');
  const pkcs1 = /BEGIN RSA PRIVATE KEY/.test(text);
  const base64 = text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (!pkcs1) return bytes;
  return der(
    0x30,
    Uint8Array.from([
      ...der(0x02, Uint8Array.of(0)),
      ...RSA_ALGORITHM_IDENTIFIER,
      ...der(0x04, bytes),
    ]),
  );
}

const imported = new Map<string, Promise<CryptoKey>>();

/** Standard base64 of the signature over `body`. */
export async function signBody(pem: string, body: string): Promise<string> {
  let key = imported.get(pem);
  if (!key) {
    key = crypto.subtle.importKey(
      'pkcs8',
      pemToPkcs8(pem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    imported.set(pem, key);
  }
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await key,
    new TextEncoder().encode(body),
  );
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
