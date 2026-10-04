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
 * `magic_link` is the one exception: its code leads the subject instead, and
 * names both "verification code" and "OTP" — see
 * `supabase/templates/_README.md` for why. Every shape here keeps the token
 * in the subject, which is the part Gmail's and Apple's autofill actually
 * look for.
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

  it('magic_link leads with the token and names the code keywords', () => {
    const magicLink = subjects.find((match) => match[1] === 'magic_link');
    expect(magicLink?.[2]).toBe('{{ .Token }} is your Waves verification code (OTP)');
  });
});

/**
 * The sign-in code mail specifically: the one redesigned to read like
 * Google's or Amazon's verification-code mail, and shaped to match the mail
 * Gmail is known to draw its own "Code requested — Copy code" card above
 * (a plain "Your One Time Password(OTP) is:" line, the digits alone, then an
 * expiry line — no box, no border, no letter-spacing on the code). These
 * checks are what keep the next edit from sliding back to a styled code
 * field or a split token without anyone noticing.
 */
describe('the sign-in code mail (magic-link.html)', () => {
  const html = readFileSync(join(TEMPLATE_DIR, 'magic-link.html'), 'utf8');
  // The token appears twice: once in the hidden preheader, once in the
  // visible body. The second is the one the box/border/letter-spacing checks
  // below care about — the preheader is plain text with no styling at all.
  const firstTokenAt = html.indexOf('{{ .Token }}');
  const tokenAt = html.indexOf('{{ .Token }}', firstTokenAt + 1);

  it('renders the code as one unbroken token, not split', () => {
    // The token placeholder itself must appear whole, with no characters or
    // markup injected between `{{` and `}}` that would slice the rendered
    // digits apart (e.g. one tag per digit).
    expect(html).toContain('{{ .Token }}');
    expect(tokenAt).toBeGreaterThan(-1);
  });

  it('gives the code no box, border, background, or letter-spacing', () => {
    // Every one of these is a way of drawing a "code field" — the same
    // family of visual trick as a per-digit box — that the CDSL-style mail
    // Gmail is known to classify as an OTP does not use. Scoped to the 400
    // characters around the token rather than the whole file, so a border or
    // background used elsewhere in the layout (the card, the footer rule)
    // does not fail this.
    const nearby = html.slice(Math.max(0, tokenAt - 400), tokenAt + 200);
    expect(nearby).not.toMatch(/border(?!-radius)/);
    expect(nearby).not.toMatch(/background/);
    expect(nearby).not.toMatch(/letter-spacing:\s*(?!normal)\S/);
  });

  it('introduces the code in plain words, then states it alone, then its expiry', () => {
    // The three lines the owner's target mail uses, in order: the lead
    // sentence, the bare digits, the expiry. Each must be its own block so
    // GoTrue's plain-text derivation keeps them on separate lines too.
    const lead = html.indexOf('Your one-time password (OTP) for Waves is:');
    const expiry = html.indexOf('This OTP expires in 15 minutes.');
    expect(lead).toBeGreaterThan(-1);
    expect(expiry).toBeGreaterThan(-1);
    expect(lead).toBeLessThan(tokenAt);
    expect(tokenAt).toBeLessThan(expiry);
  });

  it('keeps the code in the subject and preview text, with the OTP keyword', () => {
    expect(html).toMatch(/\{\{ \.Token \}\} is your Waves verification code \(OTP\)/);
  });

  it('uses the brand purple, not the old off-brand green', () => {
    expect(html).not.toContain('#4f9a2e');
    expect(html.toLowerCase()).toContain('#6c4ee3');
  });

  it('still names the recipient address in the footer', () => {
    expect(html).toContain('Sent to {{ .Email }}');
  });
});
