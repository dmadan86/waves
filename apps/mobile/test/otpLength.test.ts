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
      // `magic_link` reads "This code expires in …"; the rest read "Expires
      // in … , and works once." — both end in "xpires in N minutes".
      const stated = /xpires in (\d+) minutes/.exec(html);
      expect(stated, `${name} does not state an expiry`).not.toBeNull();
      expect(Number(stated?.[1]), name).toBe(minutes);
    }
  });

  it('covers every template, so a new one cannot ship unchecked', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });
});

/**
 * The code is in the subject, worded the way inboxes read a one-time code:
 * "Use code 123456 to ...". Gmail then draws the code above the mail with its
 * own Copy button, and it shows in the notification before anyone opens it.
 * A subject without it ("Your Waves sign-in code") gets none of that.
 *
 * `magic_link` is the one exception: its code leads the subject instead
 * ("123456 is your Waves sign-in code"), matching Google's and Amazon's own
 * sign-in-code mail — see `supabase/templates/_README.md`. Either shape keeps
 * the token in the subject, which is the part Gmail's and Apple's autofill
 * actually look for.
 */
describe('every code mail subject', () => {
  const subjects = [
    ...CONFIG.matchAll(/^\[auth\.email\.template\.(\w+)\]\s*\nsubject = "([^"]*)"/gm),
  ];
  const other = subjects.filter((match) => match[1] !== 'magic_link');

  it('covers every template', () => {
    expect(subjects.map((match) => match[1]).sort()).toEqual(
      ['confirmation', 'email_change', 'magic_link', 'reauthentication', 'recovery'].sort(),
    );
  });

  it.each(other.map((match) => [match[1], match[2]] as const))(
    '%s starts with "Use code {{ .Token }}"',
    (_name, subject) => {
      expect(subject.startsWith('Use code {{ .Token }} to ')).toBe(true);
    },
  );

  it('magic_link leads with the token instead', () => {
    const magicLink = subjects.find((match) => match[1] === 'magic_link');
    expect(magicLink?.[2]).toBe('{{ .Token }} is your Waves sign-in code');
  });
});

/**
 * The sign-in code mail specifically: the one redesigned to read like
 * Google's or Amazon's verification-code mail rather than like a generic
 * code-in-a-box template. These checks are what keep the next edit from
 * sliding back to letter-spacing or a split token without anyone noticing.
 */
describe('the sign-in code mail (magic-link.html)', () => {
  const html = readFileSync(join(TEMPLATE_DIR, 'magic-link.html'), 'utf8');

  it('renders the code as one unbroken token, not split or letter-spaced', () => {
    // The token placeholder itself must appear whole, with no characters or
    // markup injected between `{{` and `}}` that would slice the rendered
    // digits apart (e.g. one tag per digit).
    expect(html).toContain('{{ .Token }}');
    // The field holding the code must not carry CSS letter-spacing, which is
    // the same visual trick as a per-digit box and risks the same thing:
    // Gmail's "Copy code" chip and iOS/macOS AutoFill pattern-match a
    // contiguous digit string.
    const codeField = html.slice(html.indexOf('{{ .Token }}') - 600, html.indexOf('{{ .Token }}'));
    expect(codeField).not.toMatch(/letter-spacing:\s*(?!normal)\S/);
  });

  it('keeps the code in the preview text, code first', () => {
    expect(html).toMatch(/\{\{ \.Token \}\} is your Waves sign-in code/);
  });

  it('uses the brand purple, not the old off-brand green', () => {
    expect(html).not.toContain('#4f9a2e');
    expect(html.toLowerCase()).toContain('#6c4ee3');
  });

  it('still names the recipient address in the footer', () => {
    expect(html).toContain('Sent to {{ .Email }}');
  });
});
