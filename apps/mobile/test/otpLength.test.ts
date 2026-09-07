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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CONFIG = readFileSync(join(__dirname, '../../../supabase/config.toml'), 'utf8');
const OTP_INPUT = readFileSync(join(__dirname, '../src/components/OtpInput.tsx'), 'utf8');

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
