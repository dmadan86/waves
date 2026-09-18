import { test, expect } from '@playwright/test';

/**
 * The language and text direction are decided on the server from
 * Accept-Language (layout.tsx), so `<html lang>` / `<html dir>` are right in the
 * first paint rather than corrected after hydration. An Arabic reader should
 * find the page already the right way round.
 */
test.describe('language from Accept-Language', () => {
  test('English by default — left to right', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  /**
   * All four, not just the two ends of the range.
   *
   * English and Arabic were here because they are the direction cases. The two
   * in between are where a language quietly falls back: nothing throws when a
   * table is missing a key, the page simply renders English while `lang` says
   * otherwise. Each assertion names copy only that language has, so a fallback
   * fails the test rather than passing it — checked by making the Tamil case
   * expect the English string, which failed as it should.
   */
  const OTHERS = [
    { tag: 'ta', dir: 'ltr', google: /Google மூலம் தொடரவும்/ },
    { tag: 'hi', dir: 'ltr', google: /Google से जारी रखें/ },
    { tag: 'ar', dir: 'rtl', google: /المتابعة عبر Google/ },
  ] as const;

  for (const language of OTHERS) {
    test.describe(language.tag, () => {
      test.use({
        locale: language.tag,
        extraHTTPHeaders: { 'Accept-Language': language.tag },
      });

      test(`renders ${language.dir}, in its own words`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('lang', language.tag);
        await expect(page.locator('html')).toHaveAttribute('dir', language.dir);
        await expect(page.getByRole('button', { name: language.google })).toBeVisible();
      });
    });
  }
});
