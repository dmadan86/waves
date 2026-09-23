// @ts-nocheck
/**
 * The one way the demo seeder and its cleanup open a database connection.
 *
 * Shared so that the two halves cannot drift apart on the things that matter:
 * which hosts they will talk to, whether they check who is on the other end,
 * and which role they act as.
 *
 *   • A non-local host needs SEED_ALLOW_REMOTE=1, and the production project
 *     needs SEED_ALLOW_PROD=1 on top — two separate deliberate acts.
 *   • TLS is verified. Supabase signs its pooler and database certificates with
 *     its own private root, so the public trust store alone cannot verify them;
 *     that root is pinned below (it is a public certificate, not a secret).
 *     SEED_DB_CA_FILE replaces it for any other host.
 *   • SEED_SET_ROLE is assumed right after connecting. The Supabase CLI's
 *     temporary login role (`cli_login_postgres`) is a member of postgres but
 *     does not inherit it, so without this it can read nothing it needs.
 */

import fs from 'node:fs';

import pg from 'pg';

/** The production project. Named so the guard can say what it is guarding. */
export const PROD_REF = 'ywojpnfyxxltvihqmcni';

/**
 * Supabase Root 2021 CA — the self-signed root above "Supabase Intermediate
 * 2021 CA", which signs `*.pooler.supabase.com`. Valid until 2031-04-26.
 * SHA-256 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:
 *         82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
 */
const SUPABASE_ROOT_CA = `
-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`.trim();

/**
 * Guards, connects, verifies TLS, assumes SEED_SET_ROLE. Throws before any
 * network traffic when a guard refuses.
 */
export async function openSeedClient(connectionUrl, applicationName) {
  if (!connectionUrl) {
    throw new Error('No SEED_DATABASE_URL and no DIRECT_URL. Nothing to connect to.');
  }

  const parsed = new URL(connectionUrl.replace(/^postgres(ql)?:/, 'http:'));
  const host = parsed.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const isProd = connectionUrl.includes(PROD_REF);

  if (!isLocal && process.env.SEED_ALLOW_REMOTE !== '1') {
    throw new Error(
      `Refusing a non-local host (${host}) without SEED_ALLOW_REMOTE=1. This writes ` +
        `rows into whatever it is pointed at.`,
    );
  }
  if (isProd && process.env.SEED_ALLOW_PROD !== '1') {
    throw new Error(
      `That is the production project (${PROD_REF}). Set SEED_ALLOW_PROD=1 as well if ` +
        `you really mean it.`,
    );
  }

  // pg reads sslmode=require as verify-full against the public trust store,
  // which cannot know Supabase's private root. Strip it and verify explicitly.
  const connectionString = connectionUrl.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '');
  const ca = process.env.SEED_DB_CA_FILE
    ? fs.readFileSync(process.env.SEED_DB_CA_FILE, 'utf8')
    : SUPABASE_ROOT_CA;

  const client = new pg.Client({
    connectionString,
    ssl: isLocal ? undefined : { ca, rejectUnauthorized: true },
    application_name: applicationName,
  });
  await client.connect();

  if (process.env.SEED_SET_ROLE) {
    await client.query(`SET ROLE ${pg.escapeIdentifier(process.env.SEED_SET_ROLE)}`);
  }

  return { client, host, isProd };
}
