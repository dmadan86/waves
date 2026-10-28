import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const rpc = vi.fn();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));
import { clientAddress, recordLoginAttempt } from '@/lib/loginThrottle';

beforeEach(() => {
  rpc.mockReset();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('clientAddress', () => {
  it('prefers Cloudflare, then real IP, then the last forwarded address', () => {
    const headers = new Headers({
      'cf-connecting-ip': '1.2.3.4',
      'x-real-ip': '5.6.7.8',
      'x-forwarded-for': 'spoofed, 9.9.9.9',
    });
    expect(clientAddress(headers)).toBe('1.2.3.4');
    headers.delete('cf-connecting-ip');
    expect(clientAddress(headers)).toBe('5.6.7.8');
    headers.delete('x-real-ip');
    expect(clientAddress(headers)).toBe('9.9.9.9');
    headers.set('x-forwarded-for', ' 9.9.9.9 ');
    expect(clientAddress(headers)).toBe('9.9.9.9');
    headers.set('x-forwarded-for', '');
    expect(clientAddress(headers)).toBe('unknown');
    expect(clientAddress(new Headers())).toBe('unknown');
  });
});

describe('recordLoginAttempt', () => {
  it('counts both buckets with the same window', async () => {
    rpc.mockResolvedValue({ data: { allowed: true }, error: null });
    await expect(recordLoginAttempt('1.2.3.4')).resolves.toEqual({ allowed: true, retryAfter: 0 });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, 'waves_rate_limit', {
      p_subject: 'ip:1.2.3.4',
      p_bucket: 'admin-login',
      p_limit: 10,
      p_window_seconds: 900,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'waves_rate_limit', {
      p_subject: 'global',
      p_bucket: 'admin-login-global',
      p_limit: 100,
      p_window_seconds: 900,
    });
  });

  it.each(['admin-login', 'admin-login-global'])('blocks and alerts for %s', async (bucket) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const allow = { data: { allowed: true }, error: null };
    const block = { data: { allowed: false, retryAfter: 42 }, error: null };
    rpc
      .mockResolvedValueOnce(bucket === 'admin-login' ? block : allow)
      .mockResolvedValueOnce(bucket === 'admin-login-global' ? block : allow);
    await expect(recordLoginAttempt('1.2.3.4')).resolves.toEqual({
      allowed: false,
      retryAfter: 42,
    });
    expect(rpc).toHaveBeenCalledTimes(bucket === 'admin-login' ? 1 : 2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`bucket=${bucket} `));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[ALERT]'));
  });

  it('does not call the global RPC when the IP bucket blocks', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    rpc
      .mockResolvedValueOnce({ data: { allowed: false, retryAfter: 42 }, error: null })
      .mockResolvedValueOnce({ data: { allowed: false, retryAfter: 100 }, error: null });
    await expect(recordLoginAttempt('ip')).resolves.toEqual({ allowed: false, retryAfter: 42 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('waves_rate_limit', {
      p_subject: 'ip:ip',
      p_bucket: 'admin-login',
      p_limit: 10,
      p_window_seconds: 900,
    });
  });

  it.each([0, 1])('fails closed when bucket %i errors', async (index) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const allow = { data: { allowed: true }, error: null };
    const error = { data: null, error: { message: 'db down' } };
    rpc
      .mockResolvedValueOnce(index === 0 ? error : allow)
      .mockResolvedValueOnce(index === 1 ? error : allow);
    await expect(recordLoginAttempt('ip')).resolves.toEqual({ allowed: false, retryAfter: 60 });
  });

  it('fails closed when the RPC throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockRejectedValue(new Error('db down'));
    await expect(recordLoginAttempt('ip')).resolves.toEqual({ allowed: false, retryAfter: 60 });
  });

  it.each(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])(
    'requires %s in production',
    async (name) => {
      vi.stubEnv(name, '');
      vi.stubEnv('NODE_ENV', 'production');
      await expect(recordLoginAttempt('ip')).resolves.toEqual({ allowed: false, retryAfter: 60 });
      expect(rpc).not.toHaveBeenCalled();
      vi.stubEnv('NODE_ENV', 'development');
      await expect(recordLoginAttempt('ip')).resolves.toEqual({ allowed: true, retryAfter: 0 });
    },
  );
});
