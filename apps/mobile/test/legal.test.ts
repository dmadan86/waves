import { describe, expect, it, vi } from 'vitest';

import { legalUrl } from '../src/lib/legal';

// Hoisted above the import by vitest.

vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn() }));
vi.mock('../src/lib/observability', () => ({ reportHandled: vi.fn() }));

describe('legalUrl', () => {
  it('points at the site page in the app language', () => {
    expect(legalUrl('terms', 'en')).toBe('https://wavs.co.in/en/terms');
    expect(legalUrl('privacy', 'ar')).toBe('https://wavs.co.in/ar/privacy');
  });

  it('falls back to English for a language the site does not publish', () => {
    expect(legalUrl('terms', 'fr')).toBe('https://wavs.co.in/en/terms');
  });
});
