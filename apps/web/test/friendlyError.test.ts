import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import * as Sentry from '@sentry/nextjs';

import { friendlyError } from '../src/lib/errors';

const words = { fallback: 'fallback', offline: 'offline', tooMany: 'too many' };

describe('friendlyError', () => {
  it('never returns the backend’s own sentence', () => {
    // The four shapes seen in the wild, each of which used to be rendered
    // verbatim to whoever was on the page.
    const raw = [
      { message: 'new row violates row-level security policy for table "expenses"' },
      { message: 'Could not find the function public.waves_create_group in the schema cache' },
      { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      { message: 'JWT expired' },
    ];
    for (const error of raw) expect(friendlyError(error, 'test', words)).toBe('fallback');
  });

  it('names a dropped connection, without echoing the transport’s words', () => {
    expect(friendlyError(new TypeError('Failed to fetch'), 'test', words)).toBe('offline');
    expect(friendlyError({ message: 'network request failed' }, 'test', words)).toBe('offline');
  });

  it('separates going too fast from being refused', () => {
    expect(friendlyError({ status: 429, message: 'nope' }, 'test', words)).toBe('too many');
    expect(friendlyError({ code: 'over_email_send_rate_limit' }, 'test', words)).toBe('too many');
  });

  it('falls back when the caller offers no special wording', () => {
    expect(friendlyError({ status: 429 }, 'test', { fallback: 'only' })).toBe('only');
    expect(friendlyError(new Error('fetch failed'), 'test', { fallback: 'only' })).toBe('only');
  });

  it('reports the original, tagged with where it happened', () => {
    const original = new Error('permission denied for table groups');
    friendlyError(original, 'web.group.load', words);
    expect(Sentry.captureException).toHaveBeenCalledWith(original, {
      tags: { where: 'web.group.load' },
    });
  });

  it('survives a thrown non-error', () => {
    expect(friendlyError(null, 'test', words)).toBe('fallback');
    expect(friendlyError('plain string', 'test', words)).toBe('fallback');
  });
});
