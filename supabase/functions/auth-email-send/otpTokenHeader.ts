/**
 * Serializer for the `OTP-Token` email header field
 * (draft-goto-otp-token-01):
 *
 *     OTP-Token: "123456"; origin="https://wavs.co.in"
 *
 * The value is an RFC 9651 Structured Field item: a String bare item carrying
 * the code, with one required `origin` parameter that is itself a String. The
 * origin is canonical — `https`, lowercase, no path, no default port — because a
 * mail client uses it to decide which site may autofill the code.
 *
 * Pure, and total: anything that cannot be serialized faithfully yields `null`,
 * and the caller omits the header. A malformed header must never be the reason
 * a sign-in code does not arrive.
 */

/** RFC 9651 String: printable ASCII only (0x20-0x7E), `\` and `"` escaped. */
function sfString(value: string): string | null {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return null;
  }
  return `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const ORIGIN = new RegExp(`^https://${LABEL}(?:\\.${LABEL})*(?::(\\d{1,5}))?$`);

/** True for an https origin that is already in canonical form. */
export function isCanonicalHttpsOrigin(origin: string): boolean {
  const match = ORIGIN.exec(origin);
  if (!match) return false;
  const port = match[1];
  if (port === undefined) return true;
  if (port.startsWith('0')) return false;
  const n = Number(port);
  return n >= 1 && n <= 65535 && n !== 443;
}

/** The header value, or `null` when the code or origin cannot be serialized. */
export function otpTokenHeader(code: string, origin: string): string | null {
  if (!code) return null;
  if (!isCanonicalHttpsOrigin(origin)) return null;
  const token = sfString(code);
  const param = sfString(origin);
  if (token === null || param === null) return null;
  return `${token}; origin=${param}`;
}
