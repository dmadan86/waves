import { test, expect } from '@playwright/test';

/**
 * The Waves Assistant (follow-up questions, typed commands, undo) is mobile
 * only. This guards against a shared component carrying it onto the web by
 * accident: the surfaces a signed-out browser can reach must not mention it.
 * (The signed-in add-expense page needs a live session, which this suite does
 * not have; `test/assistantAbsent.test.ts` covers the source of the whole app.)
 */
const ASSISTANT_UI =
  /follow-up questions|ask the assistant|assistant follow-ups|type a command or a question|complete this expense|don't ask this again/i;

for (const path of ['/', '/add']) {
  test(`no assistant UI on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText(ASSISTANT_UI)).toHaveCount(0);
    await expect(page.getByRole('button', { name: ASSISTANT_UI })).toHaveCount(0);
  });
}
