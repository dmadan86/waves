import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clip = vi.hoisted(() => ({ value: '' }));
vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn(async (v: string) => void (clip.value = v)),
  getStringAsync: vi.fn(async () => clip.value),
}));

import { copySensitive } from '@/lib/sensitiveClipboard';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('copySensitive', () => {
  it('clears the clipboard after a minute if it still holds the value', async () => {
    await copySensitive('KEY-1');
    expect(clip.value).toBe('KEY-1');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clip.value).toBe('');
  });

  it('leaves something the user copied since', async () => {
    await copySensitive('KEY-2');
    clip.value = 'shopping list';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clip.value).toBe('shopping list');
  });

  it('still wipes the first secret after a second was copied', async () => {
    await copySensitive('A');
    await vi.advanceTimersByTimeAsync(30_000);
    await copySensitive('B');
    await vi.advanceTimersByTimeAsync(30_000); // A's timer fires, clipboard holds B: untouched
    expect(clip.value).toBe('B');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(clip.value).toBe('');
  });
});
