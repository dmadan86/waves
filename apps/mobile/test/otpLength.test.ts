/**
 * The code screen and the server have to agree on how many digits there are.
 *
 * They did not, and the failure was quiet in the worst way: `otp_length = 8` in
 * `supabase/config.toml` against `OTP_LEN = 6` in the app. The mail arrived, the
 * digits in it were correct, and the six-box screen silently sliced the code to
 * its first six characters — so signing in by email could not be completed on a
 * phone at all, and nothing anywhere said why.
 *
 * Neither value can be derived from the other (one is a TOML file the Supabase
 * CLI pushes, the other a TypeScript constant compiled into the app), so this
 * reads both and insists they match.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CONFIG = readFileSync(join(__dirname, '../../../supabase/config.toml'), 'utf8');
const OTP_INPUT = readFileSync(join(__dirname, '../src/components/OtpInput.tsx'), 'utf8');
const TEMPLATE_DIR = join(__dirname, '../../../supabase/templates');
const TEMPLATES = readdirSync(TEMPLATE_DIR).filter((name) => name.endsWith('.html'));

/**
 * Read as source rather than imported: `OtpInput` pulls in react-native, which
 * this node-environment suite cannot parse. The constant is a plain literal, so
 * reading it is exact.
 */
function appOtpLength(): number {
  const match = /export const OTP_LEN\s*=\s*(\d+)/.exec(OTP_INPUT);
  if (!match) throw new Error('OTP_LEN is not a plain literal in OtpInput.tsx any more');
  return Number(match[1]);
}

/** The `otp_length` under `[auth.email]`, as the CLI would read it. */
function configuredOtpLength(): number {
  const match = /^otp_length\s*=\s*(\d+)\s*$/m.exec(CONFIG);
  if (!match) throw new Error('otp_length is not set in supabase/config.toml');
  return Number(match[1]);
}

describe('the sign-in code', () => {
  it('is the same length on the server and in the app', () => {
    expect(configuredOtpLength()).toBe(appOtpLength());
  });

  /**
   * GoTrue refuses anything outside 6–10. Below the floor the value is not
   * rejected loudly — it is a config push that does not do what it says.
   */
  it('stays inside the range GoTrue accepts', () => {
    expect(configuredOtpLength()).toBeGreaterThanOrEqual(6);
    expect(configuredOtpLength()).toBeLessThanOrEqual(10);
  });
});

/**
 * The mail states a number of minutes. A template saying fifteen while GoTrue
 * expires the code in sixty is not a cosmetic mismatch — it is the app lying to
 * somebody about how long they have, which they only discover by being refused.
 */
describe('how long the code lasts', () => {
  function configuredExpirySeconds(): number {
    const match = /^otp_expiry\s*=\s*(\d+)\s*$/m.exec(CONFIG);
    if (!match) throw new Error('otp_expiry is not set in supabase/config.toml');
    return Number(match[1]);
  }

  it('is the number of minutes every template promises', () => {
    const minutes = configuredExpirySeconds() / 60;
    for (const name of TEMPLATES) {
      const html = readFileSync(join(TEMPLATE_DIR, name), 'utf8');
      const stated = /Expires in (\d+) minutes/.exec(html);
      expect(stated, `${name} does not state an expiry`).not.toBeNull();
      expect(Number(stated?.[1]), name).toBe(minutes);
    }
  });

  it('covers every template, so a new one cannot ship unchecked', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });
});
