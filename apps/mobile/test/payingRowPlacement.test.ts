/**
 * The Paying row belongs in the Your Account screen, not in the top-level
 * Settings list. Keeping these assertions in sync with the source means a
 * future accidental re-addition to Settings is caught immediately.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

describe('Paying row placement', () => {
  it('Settings (profile.tsx) does NOT contain the Paying row that routes to /settings/paying in the Account section', () => {
    const profile = src('app/profile.tsx');
    // The row label key and its route must not appear together in profile.tsx
    expect(profile).not.toMatch(/facePaying[\s\S]{0,200}\/settings\/paying/);
    expect(profile).not.toMatch(/\/settings\/paying[\s\S]{0,200}facePaying/);
  });

  it('Your Account screen (settings/account.tsx) contains the Paying row pointing to /settings/paying', () => {
    const account = src('app/settings/account.tsx');
    expect(account).toContain('t.account.facePaying');
    expect(account).toContain('t.account.howPeoplePayYou');
    expect(account).toContain("router.push('/settings/paying')");
  });

  it('Paying screen itself (/settings/paying.tsx) is unchanged', () => {
    const paying = src('app/settings/paying.tsx');
    // The paying screen still exists and is a standalone screen
    expect(paying).toContain('function PayingScreen');
  });
});
