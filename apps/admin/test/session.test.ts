import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  hasTrustedOrigin,
  isValidToken,
  issueToken,
  checkPassword,
  csrfTokenFor,
} from '@/lib/session';

const ORIGIN_SECRET = 'origin-secret-value';

beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = 's'.repeat(40);
  process.env.ADMIN_PASSWORD = 'correct horse battery staple';
});

describe('hasTrustedOrigin', () => {
  afterEach(() => {
    process.env.ADMIN_ORIGIN_SECRET = ORIGIN_SECRET;
    process.env.NODE_ENV = 'test';
  });

  it('accepts the exact secret in the header', async () => {
    process.env.ADMIN_ORIGIN_SECRET = ORIGIN_SECRET;
    await expect(hasTrustedOrigin(ORIGIN_SECRET)).resolves.toBe(true);
  });

  it('rejects a missing header even when a secret is configured', async () => {
    process.env.ADMIN_ORIGIN_SECRET = ORIGIN_SECRET;
    await expect(hasTrustedOrigin(null)).resolves.toBe(false);
    await expect(hasTrustedOrigin(undefined)).resolves.toBe(false);
    await expect(hasTrustedOrigin('')).resolves.toBe(false);
  });

  it('rejects a wrong header value', async () => {
    process.env.ADMIN_ORIGIN_SECRET = ORIGIN_SECRET;
    await expect(hasTrustedOrigin('not-the-secret')).resolves.toBe(false);
  });

  it('fails closed in production when the secret is unset', async () => {
    delete process.env.ADMIN_ORIGIN_SECRET;
    process.env.NODE_ENV = 'production';
    await expect(hasTrustedOrigin('anything')).resolves.toBe(false);
    await expect(hasTrustedOrigin(null)).resolves.toBe(false);
  });

  it('opens off production when the secret is unset (localhost dev)', async () => {
    delete process.env.ADMIN_ORIGIN_SECRET;
    process.env.NODE_ENV = 'development';
    await expect(hasTrustedOrigin(null)).resolves.toBe(true);
  });
});

describe('session cookie', () => {
  it('accepts a freshly issued token and rejects tampering', async () => {
    const token = await issueToken();
    await expect(isValidToken(token.value)).resolves.toBe(true);
    await expect(isValidToken(undefined)).resolves.toBe(false);
    await expect(isValidToken(`${token.value}x`)).resolves.toBe(false);
    const [expiry] = token.value.split('.');
    await expect(isValidToken(`${expiry}.forged`)).resolves.toBe(false);
  });

  it('checks the password constant-time-style', async () => {
    await expect(checkPassword('correct horse battery staple')).resolves.toBe(true);
    await expect(checkPassword('wrong')).resolves.toBe(false);
    await expect(checkPassword('')).resolves.toBe(false);
  });
});

describe('session secret strength', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('rejects a 31-character secret for signing, verification, and CSRF', async () => {
    const token = await issueToken();
    vi.stubEnv('ADMIN_SESSION_SECRET', 'x'.repeat(31));
    const message = 'ADMIN_SESSION_SECRET must be at least 32 characters.';
    await expect(issueToken()).rejects.toThrow(message);
    await expect(isValidToken(token.value)).rejects.toThrow(message);
    await expect(csrfTokenFor(token.value)).rejects.toThrow(message);
  });

  it('accepts a 32-character secret', async () => {
    vi.stubEnv('ADMIN_SESSION_SECRET', 'x'.repeat(32));
    const token = await issueToken();
    await expect(isValidToken(token.value)).resolves.toBe(true);
  });
});

describe('session cookie name', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    ['production', '__Host-waves_admin'],
    ['development', 'waves_admin'],
    ['test', 'waves_admin'],
  ])('uses the correct name in %s', async (env, name) => {
    vi.stubEnv('NODE_ENV', env);
    vi.resetModules();
    const session = await import('@/lib/session');
    expect(session.SESSION_COOKIE).toBe(name);
    expect((await session.issueToken()).name).toBe(name);
  });
});
